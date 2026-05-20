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
// Cursor snap: while the user's raw vertical position (actualY) lands on a
// grapheme, the rendered display Y eases toward the line's underline (bottom +
// 2 px). Same lerp-toward-target mechanic the trail uses in normal mode, just
// applied to the cursor itself.
//
// Pencil visual: while drawing or while overGlyph, swap the small white dot
// for a ✏️ emoji.
//
// 다른 모듈은 좌표 필요 시 window.__portal.{locked, x, y} 참조.

const EDGE_PAD = 6;              // 줄 끝 트리거 여유
const SLOW_VELOCITY = 1.6;       // px/ms 이하만 텔레포트 (빠른 스캔 무시)
const TELEPORT_COOLDOWN_MS = 280;
const LINE_TOLERANCE = 6;        // 같은 줄 판정 오차
const SNAP_OFFSET = 2;           // px below glyph bottom (= underline line)
const SNAP_DURATION = 260;       // ms — ease-in-out duration

const state = {
  locked: false,
  // x is identical to the actual horizontal cursor (no horizontal snap).
  x: 0,
  // y is the RENDERED y (post-snap). External readers (highlight.js, signals.js)
  // use this so events line up with what's visible.
  y: 0,
  // actualY is the raw cumulative vertical position from movementY — what the
  // user's hand actually pointed at. Snap eases y toward snapY but actualY
  // tracks intent so the user can move out of a snapped line by moving up
  // far enough.
  actualY: 0,
  // The current snap target — set whenever the cursor is over a glyph; kept
  // around briefly after leaving so the ease-out animation has a smooth target.
  snapY: 0,
  // Most recent paragraph the cursor was visibly over. Used by the teleport
  // logic so backward-teleport works even when cursor is in the side margin.
  lastPara: null,
  // Cached "is cursor over a grapheme right now" — updated in mousemove,
  // read in tick to decide the pencil visual class.
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

// Snap interpolation
let snapAmount = 0;     // 0..1
let snapTarget = 0;     // 0 or 1
let snapAnim = null;    // { from, to, startT, duration }

export function initPortal() {
  toggleBtn = document.createElement("button");
  toggleBtn.id = "portal-toggle";
  toggleBtn.type = "button";
  toggleBtn.textContent = "📖 독서 모드";
  toggleBtn.title = "Pointer Lock + 줄 끝 텔레포트 + 라인 스냅";
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
    state.x = window.innerWidth / 2;
    state.actualY = window.innerHeight / 2;
    state.y = state.actualY;
    state.snapY = state.actualY;
    state.overGlyph = false;
    state.lastPara = null;
    snapAmount = 0;
    snapTarget = 0;
    snapAnim = null;
    lastMoveT = performance.now();
    velocity = 0;
    renderCursor();
    startTick();
  } else {
    cursorEl.style.display = "none";
    cursorEl.classList.remove("over-text", "is-pencil");
    toggleBtn.classList.remove("is-active");
    state.lastPara = null;
    state.overGlyph = false;
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

  // Hit test at the raw intent position. Use that to drive snap engagement
  // and remember the last paragraph for teleport.
  const stack = document.elementsFromPoint(state.x, state.actualY);
  state.overGlyph = stack.some(
    (el) => el.matches && el.matches("[data-char-index]"),
  );
  const glyph = stack.find(
    (el) => el.matches && el.matches("[data-char-index]"),
  );
  if (glyph) {
    const rect = glyph.getBoundingClientRect();
    state.snapY = rect.bottom + SNAP_OFFSET;
  }
  // Otherwise keep state.snapY so the ease-out transition has a target.

  const para =
    stack.find((el) => el.matches && el.matches(".para")) ||
    stack
      .find((el) => el.closest && el.closest(".para"))
      ?.closest?.(".para");
  if (para) state.lastPara = para;

  // Flip snap target if we entered/left the "over text" state.
  const desired = state.overGlyph ? 1 : 0;
  if (desired !== snapTarget) {
    snapAnim = {
      from: snapAmount,
      to: desired,
      startT: now,
      duration: SNAP_DURATION,
    };
    snapTarget = desired;
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
  const now = performance.now();

  // Advance snap easing.
  if (snapAnim) {
    const t = (now - snapAnim.startT) / snapAnim.duration;
    if (t >= 1) {
      snapAmount = snapAnim.to;
      snapAnim = null;
    } else {
      snapAmount =
        snapAnim.from + (snapAnim.to - snapAnim.from) * easeInOut(t);
    }
  }

  // Display y = lerp(intent, line-bottom, amount).
  state.y = state.actualY + (state.snapY - state.actualY) * snapAmount;

  // Pencil visual switches when over text or actively drawing.
  const isDrawing = window.__highlightState === "drawing";
  cursorEl.classList.toggle("is-pencil", state.overGlyph || isDrawing);
  cursorEl.classList.toggle("over-text", state.overGlyph);

  renderCursor();
  rafId = requestAnimationFrame(tick);
}

function renderCursor() {
  cursorEl.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) translate(-50%, -50%)`;
}

function maybeTeleport(dx) {
  if (dx === 0) return;
  const para = state.lastPara;
  if (!para) return;
  const pr = para.getBoundingClientRect();
  if (state.y < pr.top - 80 || state.y > pr.bottom + 80) return;

  const lines = groupSpansByLine(
    Array.from(para.querySelectorAll("[data-char-index]")),
  );
  if (lines.length === 0) return;

  const cy = state.y;
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
  const fromX = state.x;
  const fromY = state.y;
  state.x = x;
  state.actualY = y;
  state.y = y;
  state.snapY = y;
  // Reset snap so the new line engages from scratch on the next move.
  snapAmount = 0;
  snapTarget = 0;
  snapAnim = null;
  renderCursor();
  lastTeleportT = performance.now();
  spawnGhost(fromX, fromY);
  spawnGhost(x, y);
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

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
