// portal.js
// "독서 모드" — Pointer Lock + virtual cursor + line-edge teleport.
//
// 브라우저는 보안상 JS로 시스템 마우스 좌표를 옮길 수 없다. 그래서:
//   1. Pointer Lock API로 OS 커서를 숨김
//   2. 가상 커서 DOM 요소를 직접 그림 (빨간 점 + 글로우)
//   3. pointermove의 movementX/Y(상대 델타)로 가상 좌표 누적
//   4. 가상 좌표는 우리가 통제하므로 자유롭게 텔레포트 가능
//   5. document.elementsFromPoint(vx, vy) 는 Pointer Lock 중에도 작동
//      → 가상 좌표로 hover 감지 / 단어 찾기 가능
//
// 다른 모듈은 좌표 필요 시 window.__portal.{locked, x, y} 참조.

const CURSOR_COLOR = "#D9362B";
const EDGE_PAD = 6;              // 줄 끝 트리거 여유
const SLOW_VELOCITY = 1.6;       // px/ms 이하만 텔레포트 (빠른 스캔 무시)
const TELEPORT_COOLDOWN_MS = 280;
const LINE_TOLERANCE = 6;        // 같은 줄 판정 오차

const state = {
  locked: false,
  x: 0,
  y: 0,
  // Last paragraph the virtual cursor was visibly over. We keep it so the
  // teleport logic can still find a "current line" when the cursor drifts
  // into the side margin (where elementsFromPoint doesn't return any .para).
  lastPara: null,
};
window.__portal = state;

let cursorEl = null;
let ghostHost = null;
let toggleBtn = null;
let lastMoveT = performance.now();
let velocity = 0;
let lastTeleportT = 0;

export function initPortal() {
  toggleBtn = document.createElement("button");
  toggleBtn.id = "portal-toggle";
  toggleBtn.type = "button";
  toggleBtn.textContent = "📖 독서 모드";
  toggleBtn.title = "Pointer Lock + 줄 끝 텔레포트";
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
    // Seed virtual cursor at the center of the viewport.
    state.x = window.innerWidth / 2;
    state.y = window.innerHeight / 2;
    lastMoveT = performance.now();
    velocity = 0;
    renderCursor();
  } else {
    cursorEl.style.display = "none";
    cursorEl.classList.remove("over-text");
    toggleBtn.classList.remove("is-active");
    state.lastPara = null;
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
  state.y = clamp(state.y + dy, 0, window.innerHeight - 1);

  // EMA velocity (px/ms)
  const inst = Math.hypot(dx, dy) / dt;
  velocity = velocity * 0.6 + inst * 0.4;

  // Update hover state — remember last .para under the cursor, and flag
  // when we're directly over a grapheme (used for the visual cue).
  const stack = document.elementsFromPoint(state.x, state.y);
  const overGlyph = stack.some(
    (el) => el.matches && el.matches("[data-char-index]"),
  );
  const para =
    stack.find((el) => el.matches && el.matches(".para")) ||
    stack
      .find((el) => el.closest && el.closest(".para"))
      ?.closest?.(".para");
  if (para) state.lastPara = para;
  cursorEl.classList.toggle("over-text", overGlyph);

  renderCursor();

  if (velocity < SLOW_VELOCITY && now - lastTeleportT > TELEPORT_COOLDOWN_MS) {
    maybeTeleport(dx);
  }
}

function renderCursor() {
  cursorEl.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) translate(-50%, -50%)`;
}

function maybeTeleport(dx) {
  if (dx === 0) return;
  // Prefer the cached lastPara: when the cursor crosses the line-left edge
  // it sits in the side margin where elementsFromPoint can't find a .para,
  // but the user is still semantically "on" that paragraph.
  const para = state.lastPara;
  if (!para) return;
  // Sanity-check: bail if cursor is far from the paragraph vertically
  // (scrolled away, etc).
  const pr = para.getBoundingClientRect();
  if (state.y < pr.top - 80 || state.y > pr.bottom + 80) return;

  const lines = groupSpansByLine(
    Array.from(para.querySelectorAll("[data-char-index]")),
  );
  if (lines.length === 0) return;

  // Find current line by Y position
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
  state.y = y;
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

// Group grapheme spans into lines by approximate matching .bottom Y.
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
