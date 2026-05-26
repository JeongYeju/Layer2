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
const RAW_HALF_LIFE_MS = 150;      // raw motion vector decays by half every 150ms
const MIN_BREAK_DY = 4;            // |rawDy| dead-zone below which we ignore the angle
                                   // (don't snap lines on jitter at rest)
const COMMIT_DY = LINE_HEIGHT * 0.55; // |rawDy| must reach this to actually commit
                                       // a line change. Below it the angle may already
                                       // be vertical but we only show the visual offset
                                       // (cursor leans toward next line); above it the
                                       // line lock advances. Buys the "build-up" feel
                                       // instead of a binary "snap, fire" behaviour.
const VISUAL_LEAN_GAIN = 0.6;      // how strongly rawDy drives the visual offset
const VISUAL_LEAN_MAX = LINE_HEIGHT * 0.4; // never lean past ~40% of a line so the
                                            // cursor doesn't overlap the neighbour

const state = {
  locked: false,
  x: 0,
  y: 0,                  // trail position (underline when over a glyph, else actualY)
  actualY: 0,            // vertical "true position" — used by hit-tests + highlight
  glyphRect: null,       // bbox of the single grapheme the cursor is on
  lastPara: null,
  overGlyph: false,
  // Line-lock state. When non-null, actualY is *pinned* to this y (the
  // committed line's vertical center). Mouse dy then doesn't move actualY
  // directly — it only feeds rawDy below, and a line transition only
  // commits when the angle check passes. Result: the cursor's true
  // position can't bounce between lines on a slightly tilted horizontal
  // stroke. Goes null when the cursor enters a margin / off-text area.
  lineLockedY: null,
  // Decay-accumulated raw motion vector. Every onMouseMove pushes (dx, dy)
  // in; an exponential decay with RAW_HALF_LIFE_MS half-life makes this a
  // ~150ms window on the user's recent intent. The angle of this vector
  // (vs. horizontal) is what decides line transitions. cursor-hud reads
  // it live for the motion-vector viz.
  rawDx: 0,
  rawDy: 0,
  rawT: performance.now(),
};
window.__portal = state;

// Tunables exposed for runtime tweaking — cursor-hud writes lineBreakAngle
// here. Default 33° = stroke must be at least 33° off horizontal before we
// transition lines.
window.__portalConfig = window.__portalConfig || {
  lineBreakAngle: 33,
};

let cursorEl = null;       // outer — position only (JS-controlled transform)
let cursorInner = null;    // inner — visual (size, color, scale/blur animation)
let toggleBtn = null;
let hintEl = null;         // "ESC 로 나가기" — visible only while locked
let lastMoveT = performance.now();
let velocity = 0;
let lastTeleportT = 0;
let rafId = null;
let lastScrollY = 0;       // tracks the scroll position so scroll deltas drag
                           // the cursor along with the text — see onScroll().
let scrollEl = window;     // scroll container: window, or #reader in the new
                           // viewer layout (set from initPortal opts).
function getScrollY() {
  return scrollEl === window ? window.scrollY : scrollEl.scrollTop;
}

// Visual cursor position (EMA-chased).
let renderX = 0;
let renderY = 0;

export function initPortal(opts = {}) {
  scrollEl = opts.scrollEl || window;

  if (opts.triggerEl) {
    // Use a host-provided button (e.g. a rail button) as the toggle.
    toggleBtn = opts.triggerEl;
  } else {
    toggleBtn = document.createElement("button");
    toggleBtn.id = "portal-toggle";
    toggleBtn.type = "button";
    toggleBtn.textContent = "📖 독서 모드";
    toggleBtn.title = "Pointer Lock + 단어 wrap 커서 + 줄 끝 텔레포트";
    document.body.appendChild(toggleBtn);
  }
  toggleBtn.addEventListener("click", () => {
    if (!state.locked) {
      document.body.requestPointerLock?.();
    } else {
      document.exitPointerLock?.();
    }
  });

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

  // ESC-to-exit hint. In Pointer Lock the toggle button isn't clickable
  // (system cursor is hidden, mouse events fire on body) so the only way
  // out is the browser-standard ESC. Surface that visibly.
  hintEl = document.createElement("div");
  hintEl.id = "portal-hint";
  hintEl.innerHTML = `<kbd>ESC</kbd> 로 나가기`;
  document.body.appendChild(hintEl);

  document.addEventListener("pointerlockchange", onLockChange);
  document.addEventListener("mousemove", onMouseMove);
  // Scroll listener stays installed always — onScroll keeps lastScrollY in
  // sync while unlocked so the first scroll *after* locking doesn't see a
  // huge spurious delta.
  scrollEl.addEventListener("scroll", onScroll, { passive: true });
  lastScrollY = getScrollY();
}

function onLockChange() {
  state.locked = document.pointerLockElement === document.body;
  if (state.locked) {
    cursorEl.style.display = "block";
    if (hintEl) hintEl.classList.add("is-visible");
    toggleBtn.classList.add("is-active");
    const btnRect = toggleBtn.getBoundingClientRect();
    state.x = btnRect.left + btnRect.width / 2;
    state.actualY = btnRect.top + btnRect.height / 2;
    state.y = state.actualY;
    state.glyphRect = null;
    state.overGlyph = false;
    state.lastPara = null;
    state.lineLockedY = null;
    resetRawMotion(performance.now());
    renderX = state.x;
    renderY = state.actualY;
    lastMoveT = performance.now();
    lastScrollY = getScrollY();
    velocity = 0;
    applyCursorVisual();
    startTick();
  } else {
    cursorEl.style.display = "none";
    cursorEl.classList.remove("is-wrap", "is-pencil");
    cursorEl.style.width = "";
    cursorEl.style.height = "";
    if (hintEl) hintEl.classList.remove("is-visible");
    toggleBtn.classList.remove("is-active");
    state.lastPara = null;
    state.overGlyph = false;
    state.glyphRect = null;
    state.lineLockedY = null;
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

  // Always feed raw input into the decaying motion vector. This is read by
  // the angle check AND by the cursor-hud viz; decoupled from how we then
  // update actualY (only free mode applies dy to actualY).
  accumulateRawMotion(dx, dy, now);

  const inst = Math.hypot(dx, dy) / dt;
  velocity = velocity * 0.6 + inst * 0.4;

  // X is free in both modes.
  state.x = clamp(state.x + dx, 0, window.innerWidth - 1);

  // Tracks whether *this same frame* released a paragraph-end lock. If so,
  // the hit-test below must NOT immediately re-engage the lock — actualY
  // hasn't moved enough yet to land on a different glyph, so re-locking
  // would trap the cursor inside the paragraph forever.
  let justReleased = false;

  if (state.lineLockedY != null) {
    // === Line-locked mode ===
    // actualY is pinned to the line's center y. dy is NOT applied here —
    // it only fed rawDy above. So small vertical wobble inside a
    // dx-dominant stroke can't drift the true cursor onto a neighbouring
    // line.
    state.actualY = state.lineLockedY;

    // Two-stage commit so the cursor can show a "build-up" instead of
    // launching at the first vertical-enough frame:
    //   1. Angle ≥ threshold means recent motion qualifies as vertical
    //      intent (used for both the visual lean and commit).
    //   2. |rawDy| ≥ COMMIT_DY means the user has actually pushed enough
    //      vertical magnitude to commit. Below this the cursor only leans
    //      visually (handled in applyCursorVisual); the lock stays put.
    const angleDeg = motionAngleDeg();
    const threshold = getLineBreakAngle();
    const verticalIntent =
      angleDeg >= threshold && Math.abs(state.rawDy) > MIN_BREAK_DY;
    if (verticalIntent && Math.abs(state.rawDy) >= COMMIT_DY) {
      const direction = state.rawDy > 0 ? 1 : -1;
      const next = findAdjacentLineCenter(state.lineLockedY, direction);
      if (next != null) {
        state.lineLockedY = next;
        state.actualY = next;
        resetRawMotion(now);
      } else {
        // Paragraph boundary — release the lock so the cursor can leave.
        // Mark justReleased so the same-frame hit-test below doesn't grab
        // the line back. Small nudge so the user's lean commits as actual
        // motion immediately; rest of the gap fills via subsequent dy.
        state.lineLockedY = null;
        resetRawMotion(now);
        justReleased = true;
        state.actualY = clamp(
          state.actualY + direction * LINE_HEIGHT * 0.4,
          0,
          window.innerHeight - 1,
        );
      }
    }
  } else {
    // === Free mode === (between paragraphs, off-text, before first hit)
    state.actualY = clamp(state.actualY + dy, 0, window.innerHeight - 1);
  }

  // Paragraph + glyph tracking is the same in both modes — uses the
  // possibly-pinned actualY.
  const para = findNearbyPara(state.x, state.actualY);
  if (para) state.lastPara = para;

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
    // Free mode → first glyph hit → engage the line lock. Skip if this
    // same frame just released a paragraph-end lock, otherwise we'd grab
    // the line straight back and trap the cursor in the paragraph.
    if (state.lineLockedY == null && !justReleased) {
      state.lineLockedY = (r.top + r.bottom) / 2;
      resetRawMotion(now);
    }
  } else {
    state.glyphRect = null;
    state.y = state.actualY;
    // No glyph under cursor → release the lock (free movement in margins).
    state.lineLockedY = null;
  }

  if (velocity < SLOW_VELOCITY && now - lastTeleportT > TELEPORT_COOLDOWN_MS) {
    maybeTeleport(dx);
  }
}

// Page scrolled while in reading mode → drag the cursor along with the text
// so it stays on the same glyph. Without this, the cursor's viewport y is
// fixed but every glyph in the page just slid past it, so the cursor would
// "float free" of the line it was reading. We shift state.actualY (and the
// EMA-tracked renderY) by the same delta, slide the cached glyphRect to
// match, then re-run the hit-test so glyphRect / lastPara reflect the new
// viewport positions.
function onScroll() {
  const cur = getScrollY();
  const dy = cur - lastScrollY;
  lastScrollY = cur;
  if (!state.locked || dy === 0) return;

  state.actualY = clamp(state.actualY - dy, 0, window.innerHeight - 1);
  renderY -= dy;
  if (state.glyphRect) {
    state.glyphRect.top -= dy;
    state.glyphRect.bottom -= dy;
  }
  // The locked line itself moved with the page — shift the lock target by
  // the same dy so the cursor remains pinned to its glyph after scrolling.
  if (state.lineLockedY != null) state.lineLockedY -= dy;

  const para = findNearbyPara(state.x, state.actualY);
  if (para) state.lastPara = para;
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
    // Visual-only lean toward the neighbouring line while locked. The
    // hit-test cursor (state.actualY) stays pinned to the current line
    // so highlighting + glyph wrapping stay on the right characters; this
    // offset only affects what the user *sees*, giving the cursor "room
    // to breathe" vertically and previewing the line transition before
    // the magnitude actually reaches COMMIT_DY.
    if (state.lineLockedY != null) {
      const lean = clamp(
        state.rawDy * VISUAL_LEAN_GAIN,
        -VISUAL_LEAN_MAX,
        VISUAL_LEAN_MAX,
      );
      targetY += lean;
    }
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
  // Direct hit first. Line-lock means actualY is pinned to the current
  // line's center while locked, so this hit will land on the same line as
  // long as the lock is held — no hysteresis layer needed here.
  const stack = document.elementsFromPoint(x, y);
  let g = stack.find((el) => el.matches && el.matches("[data-char-index]"));
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

// ---------- motion-vector helpers ----------
// Exponential-decay accumulator: each sample is added on top of a decayed
// previous value, so the resulting (rawDx, rawDy) is a ~150 ms window on
// the user's recent motion. Angle from horizontal of this vector decides
// whether they're "moving along the line" or "trying to leave the line".

function accumulateRawMotion(dx, dy, now) {
  const dt = Math.max(0, now - state.rawT);
  state.rawT = now;
  const decay = Math.pow(0.5, dt / RAW_HALF_LIFE_MS);
  state.rawDx = state.rawDx * decay + dx;
  state.rawDy = state.rawDy * decay + dy;
}

function resetRawMotion(now) {
  state.rawDx = 0;
  state.rawDy = 0;
  state.rawT = now || performance.now();
}

// Angle in degrees from horizontal. 0 = pure horizontal, 90 = pure vertical.
// We don't care about direction here — just dominance — so we use absolute
// components.
function motionAngleDeg() {
  const ax = Math.abs(state.rawDx);
  const ay = Math.abs(state.rawDy);
  if (ax + ay < 0.1) return 0;
  return (Math.atan2(ay, ax) * 180) / Math.PI;
}
window.__portalMotion = {
  // Read-only-ish accessor the HUD uses to draw the live vector.
  get rawDx() { return state.rawDx; },
  get rawDy() { return state.rawDy; },
  get angleDeg() { return motionAngleDeg(); },
  get threshold() { return getLineBreakAngle(); },
  get commitDy() { return COMMIT_DY; },
  get locked() { return state.lineLockedY != null; },
};

function getLineBreakAngle() {
  const v = window.__portalConfig?.lineBreakAngle;
  if (typeof v !== "number" || !isFinite(v)) return 33;
  return Math.min(Math.max(v, 5), 89);
}

// Find the center y of the line that is `direction` (±1) from the line
// whose center is `currentLineY`, within the active paragraph. Returns
// null at paragraph ends so the caller can release the lock.
function findAdjacentLineCenter(currentLineY, direction) {
  if (!state.lastPara) return null;
  const all = Array.from(state.lastPara.querySelectorAll("[data-char-index]"));
  if (all.length === 0) return null;
  const lines = groupSpansByLine(all);
  if (lines.length === 0) return null;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const lc = (lines[i].top + lines[i].bottom) / 2;
    if (Math.abs(lc - currentLineY) <= LINE_HEIGHT / 2) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= lines.length) return null;
  const t = lines[targetIdx];
  return (t.top + t.bottom) / 2;
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
  // Anchor the teleport to whichever line the *visual* cursor is committed
  // to, not raw actualY. With stickiness on, actualY can drift onto the
  // next line while the user's cursor is still visually on the previous
  // one — using actualY here would teleport from the wrong starting line.
  if (!state.glyphRect) return;
  const para = state.lastPara;
  if (!para) return;

  const lines = groupSpansByLine(
    Array.from(para.querySelectorAll("[data-char-index]")),
  );
  if (lines.length === 0) return;

  const targetBottom = state.glyphRect.bottom;
  const idx = lines.findIndex(
    (l) => Math.abs(l.bottom - targetBottom) <= LINE_TOLERANCE,
  );
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
    // Teleport lands ON a line — re-engage the lock at the destination's
    // center so the very next mousemove doesn't immediately try to break
    // out via stale rawDy.
    state.lineLockedY = y;
    resetRawMotion(performance.now());
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
