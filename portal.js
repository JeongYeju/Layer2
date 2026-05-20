// portal.js
// "독서 모드" — Pointer Lock + virtual cursor + line-edge teleport.
//
// 브라우저는 보안상 JS로 시스템 마우스 좌표를 옮길 수 없다. 그래서:
//   1. Pointer Lock API로 OS 커서를 숨김
//   2. 가상 커서 DOM 요소를 직접 그림
//   3. pointermove의 movementX/Y(상대 델타)로 가상 좌표 누적
//   4. 가상 좌표는 우리가 통제하므로 자유롭게 텔레포트 가능
//   5. document.elementsFromPoint(vx, vy) 는 Pointer Lock 중에도 작동
//      → 가상 좌표로 hover 감지 / 단어 찾기 가능
//
// Two-channel design — the cursor and the trail show different things:
//   - Trail: at the *underline* (glyph.bottom + 2) — the "reading line"
//     that signals.js paints. Lives at the bottom of the line.
//   - Cursor: wraps the *current glyph* the user is focused on — a soft
//     rounded box that grabs the character it sits over. NOT at the trail
//     line, because then the two channels would visually collapse and the
//     user can't tell which char is focused.
//
// 다른 모듈은 좌표 필요 시 window.__portal.{locked, x, y, actualY} 참조.
//   state.y     = trail position (underline when over glyph, actualY otherwise)
//   state.actualY = raw vertical intent (used by highlight.js hit-tests)

const EDGE_PAD = 6;              // 줄 끝 트리거 여유
const SLOW_VELOCITY = 1.6;       // px/ms 이하만 텔레포트 (빠른 스캔 무시)
const TELEPORT_COOLDOWN_MS = 280;
const LINE_TOLERANCE = 6;        // 같은 줄 판정 오차
const SNAP_OFFSET = 2;           // px below glyph bottom (= underline line)
const FOLLOW_RATE = 0.18;        // EMA — how quickly the cursor visual chases
                                 // the current target (glyph center or actualY).
                                 // Higher = snappier, lower = lazier.

const state = {
  locked: false,
  // x is the raw horizontal cursor position — shared with the trail.
  x: 0,
  // y is the *trail* position. When over a glyph this equals the line's
  // underline (glyph.bottom + 2); otherwise it equals actualY.
  y: 0,
  // actualY is the raw cumulative vertical position from movementY — the
  // hand's real intent. highlight.js hit-tests against this, the cursor
  // visual eases toward whichever glyph is under it.
  actualY: 0,
  // Bounding rect of the glyph the cursor is currently over (or null).
  glyphRect: null,
  // Most recent paragraph the cursor was visibly over. Used by the teleport
  // logic so backward-teleport works even when cursor is in the side margin.
  lastPara: null,
  // Cached "is cursor over a grapheme right now".
  overGlyph: false,
};
window.__portal = state;

let cursorEl = null;
let ghostHost = null;
let toggleBtn = null;
let lastMoveT = performance.now();
let velocity = 0;
let lastTeleportT = 0;
let rafId = null;

// EMA-followed cursor visual position. The cursor element renders at
// (renderX, renderY), which lazily chases either the glyph center (when
// over text) or actualY (when off text). This is what makes the cursor
// glide between adjacent glyphs as the hand moves.
let renderX = 0;
let renderY = 0;

export function initPortal() {
  toggleBtn = document.createElement("button");
  toggleBtn.id = "portal-toggle";
  toggleBtn.type = "button";
  toggleBtn.textContent = "📖 독서 모드";
  toggleBtn.title = "Pointer Lock + 줄 끝 텔레포트 + 글자 wrap 커서";
  toggleBtn.addEventListener("click", () => {
    if (!state.locked) {
      document.body.requestPointerLock?.();
    } else {
      document.exitPointerLock?.();
    }
  });
  document.body.appendChild(toggleBtn);

  cursorEl = document.createElement("div");
  cursorEl.id = "portal-cursor";
  cursorEl.style.display = "none";
  document.body.appendChild(cursorEl);

  ghostHost = document.createElement("div");
  ghostHost.id = "portal-ghost-host";
  document.body.appendChild(ghostHost);

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

  // EMA velocity (px/ms)
  const inst = Math.hypot(dx, dy) / dt;
  velocity = velocity * 0.6 + inst * 0.4;

  // Hit-test at the raw intent position — pre-snap, inside the line box.
  const stack = document.elementsFromPoint(state.x, state.actualY);
  const glyph = stack.find(
    (el) => el.matches && el.matches("[data-char-index]"),
  );
  state.overGlyph = !!glyph;
  if (glyph) {
    const rect = glyph.getBoundingClientRect();
    state.glyphRect = rect;
    // Trail rides the underline of the current line.
    state.y = rect.bottom + SNAP_OFFSET;
  } else {
    state.glyphRect = null;
    // Off text → trail follows the raw cursor.
    state.y = state.actualY;
  }

  const para =
    stack.find((el) => el.matches && el.matches(".para")) ||
    stack
      .find((el) => el.closest && el.closest(".para"))
      ?.closest?.(".para");
  if (para) state.lastPara = para;

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

  // Target the cursor wants to be at, in viewport coords.
  let targetX, targetY;
  if (state.glyphRect && !isDrawing) {
    const r = state.glyphRect;
    targetX = (r.left + r.right) / 2;
    targetY = (r.top + r.bottom) / 2;
  } else {
    targetX = state.x;
    targetY = state.actualY;
  }

  // EMA chase. The cursor glides toward the target each frame — when the
  // user crosses from one glyph to the next, the target jumps to the new
  // glyph's center and the cursor smoothly catches up. When the user
  // leaves text the target jumps back to actualY and the cursor unwraps.
  renderX += (targetX - renderX) * FOLLOW_RATE;
  renderY += (targetY - renderY) * FOLLOW_RATE;

  cursorEl.style.transform = `translate3d(${renderX.toFixed(2)}px, ${renderY.toFixed(2)}px, 0) translate(-50%, -50%)`;

  // Visual mode: drawing > glyph-wrap > default dot.
  cursorEl.classList.toggle("is-pencil", isDrawing);
  cursorEl.classList.toggle("is-wrap", !isDrawing && state.overGlyph);

  // Wrap mode resizes the box to match the glyph; default mode lets CSS
  // restore the small dot dimensions.
  if (!isDrawing && state.glyphRect) {
    const r = state.glyphRect;
    cursorEl.style.width = `${r.width.toFixed(1)}px`;
    cursorEl.style.height = `${r.height.toFixed(1)}px`;
  } else {
    cursorEl.style.width = "";
    cursorEl.style.height = "";
  }
}

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

  // Find current line by the user's vertical intent (actualY), not the
  // snapped trail position — at the line edge the trail Y sits below the
  // glyph box and the lookup misses by one.
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
  state.x = x;
  state.actualY = y;
  state.y = y;
  // Snap the cursor visual instantly to the new spot so it doesn't lag the
  // teleport — the EMA would otherwise crawl across the diagonal gap.
  renderX = x;
  renderY = y;
  applyCursorVisual();
  lastTeleportT = performance.now();
  spawnGhost(fromX, fromY);
  spawnGhost(x, y);
  // Tell other modules so they can break their continuous-path mode (trail
  // skips the connecting segment; highlight.js resets its interpolation
  // anchor so the underline chain doesn't try to span the gap).
  window.dispatchEvent(
    new CustomEvent("portal-teleport", {
      detail: { fromX, fromY, toX: x, toY: y },
    }),
  );
}

function spawnGhost(x, y) {
  const ghost = document.createElement("div");
  ghost.className = "portal-ghost";
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
  ghostHost.appendChild(ghost);
  setTimeout(() => ghost.remove(), 500);
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
