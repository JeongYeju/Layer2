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
//   - Cursor (rendered here): wraps the *word* the user is on. Not the
//     glyph — glyph-by-glyph snap felt chatty. The wrap stays put while
//     the user moves within a single word; it jumps when they cross a
//     word boundary. Conceptually a skewer through the *middle* of the
//     line, with the trail painting the descender line below it.
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
const TELEPORT_COOLDOWN_MS = 280;
const LINE_TOLERANCE = 6;
const LINE_HEIGHT = 32;            // matches .para line-height in styles.css
const SNAP_OFFSET = 2;             // px below glyph bottom (underline line)
const FOLLOW_RATE = 0.18;          // EMA — how quickly the visual chases its target
const FALLBACK_REACH = LINE_HEIGHT * 1.5; // how far off-text we'll still snap to a line

const state = {
  locked: false,
  x: 0,
  y: 0,                  // trail position (underline when over a word, else actualY)
  actualY: 0,            // raw vertical intent — highlight.js hit-tests this
  wordRect: null,        // bbox of the WORD the cursor is on (or null off-text)
  lastPara: null,
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
    state.wordRect = null;
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
    state.wordRect = null;
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
    const word = findWordBboxFromGlyph(glyph);
    if (word) {
      state.wordRect = word;
      state.y = word.bottom + SNAP_OFFSET;
    } else {
      // Whitespace-only "word" → just use the glyph's own rect
      const r = glyph.getBoundingClientRect();
      state.wordRect = {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
      state.y = r.bottom + SNAP_OFFSET;
    }
  } else {
    state.wordRect = null;
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
  if (state.wordRect && !isDrawing) {
    const r = state.wordRect;
    targetX = (r.left + r.right) / 2;
    targetY = (r.top + r.bottom) / 2;
  } else {
    targetX = state.x;
    targetY = state.actualY;
  }

  renderX += (targetX - renderX) * FOLLOW_RATE;
  renderY += (targetY - renderY) * FOLLOW_RATE;

  cursorEl.style.transform = `translate3d(${renderX.toFixed(2)}px, ${renderY.toFixed(2)}px, 0) translate(-50%, -50%)`;

  cursorEl.classList.toggle("is-pencil", isDrawing);
  cursorEl.classList.toggle("is-wrap", !isDrawing && !!state.wordRect);

  if (!isDrawing && state.wordRect) {
    const r = state.wordRect;
    cursorEl.style.width = `${r.width.toFixed(1)}px`;
    cursorEl.style.height = `${r.height.toFixed(1)}px`;
  } else {
    cursorEl.style.width = "";
    cursorEl.style.height = "";
  }
}

// ---------- hit-testing helpers ----------

function findGlyphAt(x, y) {
  // Direct hit first.
  const stack = document.elementsFromPoint(x, y);
  let g = stack.find((el) => el.matches && el.matches("[data-char-index]"));
  if (g) return g;

  // Fallback: snap to the nearest line in lastPara. This is what stops the
  // cursor from collapsing back to a dot between lines — at any y inside
  // (or near) the paragraph, we commit to either the upper or lower line.
  if (!state.lastPara) return null;
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

// Whitespace-delimited word — walk left/right from the given glyph,
// stopping at whitespace or line break. Bbox is the union of all the
// non-space glyphs in the word.
function findWordBboxFromGlyph(startGlyph) {
  const para = startGlyph.closest("[data-paragraph-id]");
  if (!para) return null;
  const allGlyphs = Array.from(para.querySelectorAll("[data-char-index]"));
  if (allGlyphs.length === 0) return null;

  const byCi = new Map();
  for (const g of allGlyphs) {
    byCi.set(parseInt(g.dataset.charIndex, 10), g);
  }
  const maxCi = allGlyphs.length - 1;
  const isSpace = (s) => /\s/.test(s);

  let centerCi = parseInt(startGlyph.dataset.charIndex, 10);
  const startBottom = startGlyph.getBoundingClientRect().bottom;

  // If we landed on whitespace, find the nearest non-space on the same line.
  if (isSpace(startGlyph.textContent)) {
    let found = false;
    for (let i = centerCi - 1; i >= 0; i--) {
      const g = byCi.get(i);
      if (!g) break;
      const r = g.getBoundingClientRect();
      if (Math.abs(r.bottom - startBottom) > LINE_TOLERANCE) break;
      if (!isSpace(g.textContent)) {
        centerCi = i;
        found = true;
        break;
      }
    }
    if (!found) {
      for (let i = centerCi + 1; i <= maxCi; i++) {
        const g = byCi.get(i);
        if (!g) break;
        const r = g.getBoundingClientRect();
        if (Math.abs(r.bottom - startBottom) > LINE_TOLERANCE) break;
        if (!isSpace(g.textContent)) {
          centerCi = i;
          found = true;
          break;
        }
      }
    }
    if (!found) return null; // whole line is whitespace
  }

  // Walk left.
  let leftCi = centerCi;
  while (leftCi > 0) {
    const prev = byCi.get(leftCi - 1);
    if (!prev) break;
    if (isSpace(prev.textContent)) break;
    const r = prev.getBoundingClientRect();
    if (Math.abs(r.bottom - startBottom) > LINE_TOLERANCE) break;
    leftCi--;
  }
  // Walk right.
  let rightCi = centerCi;
  while (rightCi < maxCi) {
    const next = byCi.get(rightCi + 1);
    if (!next) break;
    if (isSpace(next.textContent)) break;
    const r = next.getBoundingClientRect();
    if (Math.abs(r.bottom - startBottom) > LINE_TOLERANCE) break;
    rightCi++;
  }

  let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
  for (let i = leftCi; i <= rightCi; i++) {
    const g = byCi.get(i);
    if (!g) continue;
    const r = g.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    minL = Math.min(minL, r.left);
    minT = Math.min(minT, r.top);
    maxR = Math.max(maxR, r.right);
    maxB = Math.max(maxB, r.bottom);
  }
  if (!isFinite(minL)) return null;

  return {
    left: minL,
    top: minT,
    right: maxR,
    bottom: maxB,
    width: maxR - minL,
    height: maxB - minT,
  };
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
  state.x = x;
  state.actualY = y;
  state.y = y;
  renderX = x;
  renderY = y;
  applyCursorVisual();
  lastTeleportT = performance.now();
  spawnGhost(fromX, fromY);
  spawnGhost(x, y);
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
  setTimeout(() => ghost.remove(), 600);
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
