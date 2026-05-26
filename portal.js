// portal.js
// "독서 모드" — Pointer Lock + virtual cursor + line-edge teleport.
//
// 브라우저는 보안상 JS로 시스템 마우스 좌표를 옮길 수 없다. 그래서:
//   1. Pointer Lock API로 OS 커서를 숨김
//   2. 가상 커서 DOM 요소를 직접 그림
//   3. pointermove의 movementX/Y(상대 델타)로 가상 좌표 누적
//   4. 가상 좌표는 우리가 통제하므로 자유롭게 텔레포트 가능
//   5. document.elementsFromPoint(vx, vy) 는 Pointer Lock 중에도 작동
//
// Two-channel design:
//   - Trail (signals.js, reads window.__portal.y): rides the underline of
//     the current line — a "reading trail".
//   - Cursor (rendered here): a *single grapheme wide* box sized to the
//     glyph the cursor is over. Cursor X follows the user's actualX (no
//     per-glyph centering) so a smooth horizontal glide is what threads
//     the cursor through a word — the only "snap" between words is the
//     implicit width change when crossing whitespace (whitespace glyphs
//     are naturally narrow, so the box thins out, then widens again on
//     the next non-space). Conceptually a skewer through the middle of
//     the line; the trail paints the descender line below it.
//
// Off-text fallback: if the hit-test misses (cursor past a line's last
// char, or in the margin between paragraphs), we snap to the nearest line
// in the most recent paragraph. This avoids the cursor briefly collapsing
// back to a dot in between lines — the snap stays committed to either the
// upper or lower line based on which is closer.
//
// 다른 모듈은 좌표 필요 시 window.__portal.{locked, x, y, actualY} 참조.

const EDGE_PAD = 6;
const SLOW_VELOCITY = 1.6;
const TELEPORT_ANIM_MS = 400;      // total blur in/out duration
const TELEPORT_HALFWAY_MS = 200;   // when the cursor invisibly relocates
const TELEPORT_COOLDOWN_MS = 500;  // > anim duration to avoid overlapping teleports
const LINE_TOLERANCE = 6;
const LINE_HEIGHT = 32;            // matches .para line-height in styles.css
const SNAP_OFFSET = 2;             // px below glyph bottom (underline line)
const FOLLOW_RATE = 0.18;          // EMA — how quickly the visual chases its target
const FALLBACK_REACH = LINE_HEIGHT * 1.5; // how far off-text we'll still snap to a line
const EMPTY_TRAIL_REACH = 30;      // past line.right this far → no snap (free movement
                                   // in trailing empty space of a short line)

const state = {
  locked: false,
  x: 0,
  y: 0,                  // trail position (underline when over a glyph, else actualY)
  actualY: 0,            // raw vertical intent — highlight.js hit-tests this
  glyphRect: null,       // bbox of the single grapheme the cursor is on
  lastPara: null,
  overGlyph: false,
};
window.__portal = state;

// Tunables exposed for runtime tweaking — cursor-hud's "Portal" slider
// writes lineSnapStickiness into this. Default 0.4 ≈ 13 px buffer (cursor
// must drift ~13 px past the current line's bbox before snap commits to
// the new line).
window.__portalConfig = window.__portalConfig || {
  lineSnapStickiness: 0.4,
};

let cursorEl = null;       // outer — position only (JS-controlled transform)
let cursorInner = null;    // inner — visual (size, color, scale/blur animation)
let toggleBtn = null;
let lastMoveT = performance.now();
let velocity = 0;
let lastTeleportT = 0;
let rafId = null;

// Visual cursor position (EMA-chased).
let renderX = 0;
let renderY = 0;

export function initPortal() {
  toggleBtn = document.createElement("button");
  toggleBtn.id = "portal-toggle";
  toggleBtn.type = "button";
  toggleBtn.textContent = "📖 독서 모드";
  toggleBtn.title = "Pointer Lock + 단어 wrap 커서 + 줄 끝 텔레포트";
  toggleBtn.addEventListener("click", () => {
    if (!state.locked) {
      document.body.requestPointerLock?.();
    } else {
      document.exitPointerLock?.();
    }
  });
  document.body.appendChild(toggleBtn);

  // Two-element cursor: outer carries position (JS-set transform), inner
  // carries the visual (size, color, ::before pencil, and the teleport
  // scale+blur animation). Splitting them lets the animation animate
  // transform on inner without fighting the per-frame translate3d on outer.
  cursorEl = document.createElement("div");
  cursorEl.id = "portal-cursor";
  cursorEl.style.display = "none";
  cursorInner = document.createElement("div");
  cursorInner.className = "portal-cursor-inner";
  cursorEl.appendChild(cursorInner);
  document.body.appendChild(cursorEl);

  document.addEventListener("pointerlockchange", onLockChange);
  document.addEventListener("mousemove", onMouseMove);
}

function onLockChange() {
  state.locked = document.pointerLockElement === document.body;
  if (state.locked) {
    cursorEl.style.display = "block";
    toggleBtn.classList.add("is-active");
    const btnRect = toggleBtn.getBoundingClientRect();
    state.x = btnRect.left + btnRect.width / 2;
    state.actualY = btnRect.top + btnRect.height / 2;
    state.y = state.actualY;
    state.glyphRect = null;
    state.overGlyph = false;
    state.lastPara = null;
    renderX = state.x;
    renderY = state.actualY;
    lastMoveT = performance.now();
    velocity = 0;
    applyCursorVisual();
    startTick();
  } else {
    cursorEl.style.display = "none";
    cursorEl.classList.remove("is-wrap", "is-pencil");
    cursorEl.style.width = "";
    cursorEl.style.height = "";
    toggleBtn.classList.remove("is-active");
    state.lastPara = null;
    state.overGlyph = false;
    state.glyphRect = null;
    stopTick();
  }
}

function onMouseMove(e) {
  if (!state.locked) return;
  const now = performance.now();
  const dt = Math.max(1, now - lastMoveT);
  lastMoveT = now;

  const dx = e.movementX || 0;
  const dy = e.movementY || 0;
  state.x = clamp(state.x + dx, 0, window.innerWidth - 1);
  state.actualY = clamp(state.actualY + dy, 0, window.innerHeight - 1);

  const inst = Math.hypot(dx, dy) / dt;
  velocity = velocity * 0.6 + inst * 0.4;

  // Keep lastPara fresh — even in paragraph margins we want a reference
  // paragraph for the line-snap fallback. Search a small vertical band.
  const para = findNearbyPara(state.x, state.actualY);
  if (para) state.lastPara = para;

  // Hit-test glyph. If the direct point misses (line end / margin / gap),
  // fall back to the nearest glyph on the nearest line of lastPara — this
  // is what stops the cursor from going dot-mode between lines.
  const glyph = findGlyphAt(state.x, state.actualY);
  state.overGlyph = !!glyph;
  if (glyph) {
    const r = glyph.getBoundingClientRect();
    state.glyphRect = {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
    state.y = r.bottom + SNAP_OFFSET;
  } else {
    state.glyphRect = null;
    state.y = state.actualY;
  }

  if (velocity < SLOW_VELOCITY && now - lastTeleportT > TELEPORT_COOLDOWN_MS) {
    maybeTeleport(dx);
  }
}

function startTick() {
  if (rafId) return;
  rafId = requestAnimationFrame(tick);
}

function stopTick() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

function tick() {
  if (!state.locked) {
    rafId = null;
    return;
  }
  applyCursorVisual();
  rafId = requestAnimationFrame(tick);
}

function applyCursorVisual() {
  const isDrawing = window.__highlightState === "drawing";

  let targetX, targetY;
  if (state.glyphRect && !isDrawing) {
    const r = state.glyphRect;
    // X follows the user's actualX directly — within a word the cursor
    // just glides along, no per-glyph snap-to-center. Crossing into
    // whitespace is signalled by the width going thin (whitespace
    // glyphs are narrow), then widening on the next non-space.
    targetX = state.x;
    // Y snaps to the line's middle (the "skewer" position) — the trail
    // separately rides the underline two pixels lower.
    targetY = (r.top + r.bottom) / 2;
  } else {
    targetX = state.x;
    targetY = state.actualY;
  }

  renderX += (targetX - renderX) * FOLLOW_RATE;
  renderY += (targetY - renderY) * FOLLOW_RATE;

  // Outer = position only. Inner handles its own centering (translate(-50%,
  // -50%) in CSS) so a scale animation on inner doesn't need to recompute
  // the position offset every frame.
  cursorEl.style.transform = `translate3d(${renderX.toFixed(2)}px, ${renderY.toFixed(2)}px, 0)`;

  cursorEl.classList.toggle("is-pencil", isDrawing);
  cursorEl.classList.toggle("is-wrap", !isDrawing && !!state.glyphRect);

  if (!isDrawing && state.glyphRect) {
    const r = state.glyphRect;
    cursorInner.style.width = `${r.width.toFixed(1)}px`;
    cursorInner.style.height = `${r.height.toFixed(1)}px`;
  } else {
    cursorInner.style.width = "";
    cursorInner.style.height = "";
  }
}

// ---------- hit-testing helpers ----------

function findGlyphAt(x, y) {
  // Direct hit first.
  const stack = document.elementsFromPoint(x, y);
  let g = stack.find((el) => el.matches && el.matches("[data-char-index]"));

  // Line-snap hysteresis. If the direct hit is on a DIFFERENT line than the
  // one we were just on, require the cursor's y to be sufficiently past
  // the previous line's bbox before we accept the switch. Otherwise the
  // cursor flicks lines on the slightest vertical drift. Buffer is driven
  // by window.__portalConfig.lineSnapStickiness (0..1; user-tunable via
  // the slider in cursor-hud).
  if (g && state.glyphRect) {
    const oldR = state.glyphRect;
    const newR = g.getBoundingClientRect();
    const sameLine = Math.abs(newR.bottom - oldR.bottom) <= LINE_TOLERANCE;
    if (!sameLine) {
      const sticky = getLineSnapStickiness();
      const buffer = LINE_HEIGHT * sticky;
      if (y >= oldR.top - buffer && y <= oldR.bottom + buffer) {
        // Stay on the previous line. Pick a glyph on that line near x.
        const stay = findGlyphOnLineY(oldR.bottom, x);
        if (stay) return stay;
      }
    }
  }
  if (g) return g;

  if (!state.lastPara) return null;

  // Free-movement zone 1 — cursor is vertically outside the current
  // paragraph (i.e., in an inter-paragraph margin or above/below all
  // text). The user is moving through empty space, don't pull them
  // back to a line.
  const pr = state.lastPara.getBoundingClientRect();
  if (y < pr.top - 2 || y > pr.bottom + 2) return null;

  const allGlyphs = Array.from(
    state.lastPara.querySelectorAll("[data-char-index]"),
  );
  if (allGlyphs.length === 0) return null;

  const lines = groupSpansByLine(allGlyphs);
  let nearestLine = null;
  let minDist = Infinity;
  for (const l of lines) {
    const lc = (l.top + l.bottom) / 2;
    const d = Math.abs(y - lc);
    if (d < minDist) {
      minDist = d;
      nearestLine = l;
    }
  }
  if (!nearestLine || minDist > FALLBACK_REACH) return null;

  // Free-movement zone 2 — cursor is significantly past the line's last
  // glyph (a short line with empty trailing space). Don't drag the
  // cursor back to the last char; let the user move freely in that void.
  if (x > nearestLine.right + EMPTY_TRAIL_REACH) return null;
  if (x < nearestLine.left - EMPTY_TRAIL_REACH) return null;

  // Pick the glyph on that line whose center is closest to the cursor x.
  let nearestGlyph = null;
  let minXDist = Infinity;
  for (const gg of allGlyphs) {
    const r = gg.getBoundingClientRect();
    if (Math.abs(r.bottom - nearestLine.bottom) > LINE_TOLERANCE) continue;
    const gx = (r.left + r.right) / 2;
    const d = Math.abs(x - gx);
    if (d < minXDist) {
      minXDist = d;
      nearestGlyph = gg;
    }
  }
  return nearestGlyph;
}

// Find a glyph anywhere on the line whose .bottom is targetBottom, nearest
// to x. Used by the line-snap hysteresis path to keep the cursor on the
// previous line when y has drifted but not far enough to commit to the
// new line.
function findGlyphOnLineY(targetBottom, x) {
  if (!state.lastPara) return null;
  const all = Array.from(state.lastPara.querySelectorAll("[data-char-index]"));
  let nearest = null;
  let minD = Infinity;
  for (const g of all) {
    const r = g.getBoundingClientRect();
    if (Math.abs(r.bottom - targetBottom) > LINE_TOLERANCE) continue;
    const gx = (r.left + r.right) / 2;
    const d = Math.abs(x - gx);
    if (d < minD) {
      minD = d;
      nearest = g;
    }
  }
  return nearest;
}

function getLineSnapStickiness() {
  const v = window.__portalConfig?.lineSnapStickiness;
  if (typeof v !== "number" || !isFinite(v)) return 0.4;
  return Math.min(Math.max(v, 0), 1);
}

function findNearbyPara(x, y) {
  const stack = document.elementsFromPoint(x, y);
  const direct =
    stack.find((el) => el.matches && el.matches(".para")) ||
    stack
      .find((el) => el.closest && el.closest(".para"))
      ?.closest?.(".para");
  if (direct) return direct;
  // Look slightly up/down — covers the paragraph margin band.
  for (const dy of [-20, 20, -40, 40]) {
    const s = document.elementsFromPoint(x, y + dy);
    const p =
      s.find((el) => el.matches && el.matches(".para")) ||
      s.find((el) => el.closest && el.closest(".para"))?.closest?.(".para");
    if (p) return p;
  }
  return null;
}

// ---------- teleport ----------

function maybeTeleport(dx) {
  if (dx === 0) return;
  const para = state.lastPara;
  if (!para) return;
  const pr = para.getBoundingClientRect();
  if (state.actualY < pr.top - 80 || state.actualY > pr.bottom + 80) return;

  const lines = groupSpansByLine(
    Array.from(para.querySelectorAll("[data-char-index]")),
  );
  if (lines.length === 0) return;

  const cy = state.actualY;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (
      cy >= lines[i].top - LINE_TOLERANCE &&
      cy <= lines[i].bottom + LINE_TOLERANCE
    ) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return;

  const line = lines[idx];
  if (dx > 0 && state.x > line.right + EDGE_PAD) {
    if (idx + 1 < lines.length) {
      const next = lines[idx + 1];
      teleportTo(next.left + 2, (next.top + next.bottom) / 2);
    }
  } else if (dx < 0 && state.x < line.left - EDGE_PAD) {
    if (idx - 1 >= 0) {
      const prev = lines[idx - 1];
      teleportTo(prev.right - 2, (prev.top + prev.bottom) / 2);
    }
  }
}

function teleportTo(x, y) {
  const fromX = renderX;
  const fromY = renderY;
  // Phase 1: blur the cursor out at source (CSS keyframe via .is-teleporting).
  cursorEl.classList.add("is-teleporting");
  // Phase 2: at the animation halfway point the cursor is fully invisible
  // (opacity 0, max blur). That's when we relocate it — the user never sees
  // a diagonal slide, the cursor just rematerialises at the destination.
  setTimeout(() => {
    state.x = x;
    state.actualY = y;
    state.y = y;
    renderX = x;
    renderY = y;
    applyCursorVisual();
  }, TELEPORT_HALFWAY_MS);
  // Phase 3: animation ends, drop the class so the cursor is back to its
  // normal sharp state at the new spot.
  setTimeout(() => {
    cursorEl.classList.remove("is-teleporting");
  }, TELEPORT_ANIM_MS);

  lastTeleportT = performance.now();
  // Tell the trail / highlight modules immediately so they break their
  // continuous-path state right away (the trail's break segment + the
  // highlight chain's reset both want to know without waiting for the
  // visual animation to finish).
  window.dispatchEvent(
    new CustomEvent("portal-teleport", {
      detail: { fromX, fromY, toX: x, toY: y },
    }),
  );
}

function groupSpansByLine(spans) {
  const lines = [];
  for (const s of spans) {
    const r = s.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    let found = null;
    for (const l of lines) {
      if (Math.abs(r.bottom - l.bottom) <= LINE_TOLERANCE) {
        found = l;
        break;
      }
    }
    if (found) {
      found.left = Math.min(found.left, r.left);
      found.right = Math.max(found.right, r.right);
      found.top = Math.min(found.top, r.top);
      found.bottom = Math.max(found.bottom, r.bottom);
    } else {
      lines.push({
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      });
    }
  }
  lines.sort((a, b) => a.top - b.top);
  return lines;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
