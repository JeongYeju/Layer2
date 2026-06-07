// viewer-shell.js — experimental viewer chrome (branch: claude/viewer-layout).
// Wires the layout toggle (infinite scroll ↔ paper-book spread), spread
// pagination (columnize the article, translateX to flip pages), the page nav,
// the highlight color/opacity popup, the source + dashboard flyouts, and the
// bookmark / capture signal buttons. Icons are Lucide (rendered on init).

import { pushSignal, signalBus } from "./signals.js";
import { renderIcons } from "./icons.js";

const GUTTER = 64; // px gap between book columns

let readerEl, stageEl, pagenavEl, pageCurEl, pageTotalEl, prevBtn, nextBtn, toggleEl;
let mode = "scroll";
let spread = 0;
let totalSpreads = 1;
let totalPages = 1;
let pageW = 360;

const MODE_KEY = "layer2.viewmode";

export function initViewerShell() {
  readerEl = document.getElementById("reader");
  stageEl = document.getElementById("stage");
  pagenavEl = document.getElementById("pagenav");
  pageCurEl = document.getElementById("page-cur");
  pageTotalEl = document.getElementById("page-total");
  prevBtn = document.getElementById("page-prev");
  nextBtn = document.getElementById("page-next");
  toggleEl = document.getElementById("view-toggle");
  if (!readerEl) return;

  // Render the <i data-lucide> placeholders into inline (local) Lucide SVGs.
  renderIcons();

  wireLayoutToggle();
  wirePageNav();
  wireHighlightPopup();
  wireMenusAndDrawer();
  wireActionButtons();
  wireFontSize();

  let rt = 0;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(relayoutViewer, 150);
  });

  const saved = localStorage.getItem(MODE_KEY);
  setMode(saved === "spread" || saved === "board" ? saved : "scroll");
}

// ===== Layout toggle + spread pagination =====

function wireLayoutToggle() {
  toggleEl?.querySelectorAll("button[data-mode]").forEach((b) => {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  });
}

function wirePageNav() {
  prevBtn?.addEventListener("click", () => gotoSpread(spread - 1));
  nextBtn?.addEventListener("click", () => gotoSpread(spread + 1));
  document.addEventListener("keydown", (e) => {
    if (mode !== "spread") return;
    if (e.target?.matches?.("input, textarea")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") gotoSpread(spread + 1);
    else if (e.key === "ArrowLeft" || e.key === "PageUp") gotoSpread(spread - 1);
  });
}

function setMode(m) {
  mode = m === "spread" ? "spread" : m === "board" ? "board" : "scroll";
  readerEl.classList.toggle("mode-spread", mode === "spread");
  readerEl.classList.toggle("mode-scroll", mode === "scroll");
  readerEl.classList.toggle("mode-board", mode === "board");
  toggleEl?.querySelectorAll("button[data-mode]").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.mode === mode),
  );
  if (pagenavEl) pagenavEl.hidden = mode !== "spread";
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* best-effort */
  }
  if (mode !== "spread") {
    const a = readerEl.querySelector(".article");
    if (a) a.style.removeProperty("--spread-x");
  }
  // Board mode: the source drawer is a fixed overlay that would cover the
  // left-aligned column, so tuck it away on entry. Then render the trace cards.
  if (mode === "board") {
    document.body.classList.remove("drawer-open");
    renderBoardCards();
  } else {
    clearBoardCards();
  }
  spread = 0;
  relayoutViewer();
}

// ===== Board mode — interaction traces unfold to the right of each paragraph =====
// MODE 02 (이원화 뷰어, PDF). 원문 칼럼은 왼쪽으로 고정되고, 단락별 흔적(밑줄·
// 동그라미·주석)이 우측 카드로 펼쳐진다. 의미론적 접기: 흔적 없는 단락은 작은
// 점만. 마찰 색상 위계: interpret 결과(window.__lastInterpretation)가 있으면
// 단락 좌측 보더가 friction 으로 물든다.
let boardSubBound = false;
let boardRenderTimer = 0;

function clearBoardCards() {
  readerEl
    .querySelectorAll(".board-card, .board-dot")
    .forEach((el) => el.remove());
  readerEl
    .querySelectorAll(".para.has-board-card, .para.board-friction")
    .forEach((p) => {
      p.classList.remove("has-board-card", "board-friction");
      p.style.removeProperty("--friction-pct");
    });
}

function collectTraces(para) {
  const out = [];
  para.querySelectorAll(".anno-marker .anno-tooltip").forEach((t) => {
    const txt = (t.textContent || "").trim();
    out.push({ kind: "annotation", text: txt || "주석" });
  });
  if (para.querySelector(".is-annotated, .is-underlined")) {
    out.push({ kind: "underline", text: "밑줄" });
  }
  if (para.querySelector(".word-circle-mark")) {
    out.push({ kind: "circle", text: "동그라미" });
  }
  return out;
}

// friction by paragraph id, from the last interpret run (batch). Optional.
function frictionByPid() {
  const map = new Map();
  const paras = window.__lastInterpretation?.refined?.paragraphs;
  if (Array.isArray(paras)) {
    for (const p of paras) {
      if (typeof p.friction_pct === "number") map.set(p.id, p);
    }
  }
  return map;
}

function renderBoardCards() {
  if (mode !== "board") return;
  clearBoardCards();
  const fr = frictionByPid();
  for (const para of readerEl.querySelectorAll(".para[data-paragraph-id]")) {
    const pid = para.dataset.paragraphId;

    // Friction color hierarchy (좌측 보더 채도) — only if a digest exists.
    const f = fr.get(pid);
    if (f) {
      para.classList.add("board-friction");
      para.style.setProperty("--friction-pct", String(f.friction_pct ?? 0));
      if (f.friction_high) para.classList.add("has-board-card"); // ensure visible
    }

    const traces = collectTraces(para);
    if (!traces.length) {
      // Semantic folding: no trace → just a compact dot indicator.
      const dot = document.createElement("span");
      dot.className = "board-dot";
      para.appendChild(dot);
      continue;
    }
    para.classList.add("has-board-card");
    const card = document.createElement("div");
    card.className = "board-card";
    card.innerHTML = traces
      .map(
        (t) =>
          `<div class="board-trace board-trace--${t.kind}">${escapeHtml(t.text)}</div>`,
      )
      .join("");
    para.appendChild(card);
  }

  // Live refresh: while in board mode, re-render when a new trace lands.
  if (!boardSubBound) {
    boardSubBound = true;
    signalBus.addEventListener("signal", (e) => {
      if (mode !== "board") return;
      const t = e.detail?.type;
      if (
        t === "highlight_annotation" ||
        t === "highlight_underline" ||
        t === "circle_gesture"
      ) {
        clearTimeout(boardRenderTimer);
        boardRenderTimer = setTimeout(renderBoardCards, 200);
      }
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// Called by app.js after content (re)renders, and on resize / mode change.
export function relayoutViewer() {
  if (mode !== "spread") return;
  const article = readerEl.querySelector(".article");
  if (!article) return;

  const cs = getComputedStyle(readerEl);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const innerW = readerEl.clientWidth - padX;
  pageW = Math.max(160, Math.floor((innerW - GUTTER) / 2));
  article.style.setProperty("--page-w", pageW + "px");
  article.style.setProperty("--gutter", GUTTER + "px");

  // Measure once the browser has reflowed the columns.
  requestAnimationFrame(() => {
    const pitch = pageW + GUTTER;
    totalPages = Math.max(1, Math.round((article.scrollWidth + GUTTER) / pitch));
    totalSpreads = Math.max(1, Math.ceil(totalPages / 2));
    spread = Math.min(Math.max(spread, 0), totalSpreads - 1);
    applySpread();
  });
}

function gotoSpread(s) {
  const next = Math.min(Math.max(s, 0), totalSpreads - 1);
  if (next === spread) return;
  spread = next;
  applySpread();
}

// Used by the portal reading mode to advance pages while locked in spread mode.
export function flipSpread(dir) {
  gotoSpread(spread + dir);
}

function applySpread() {
  const article = readerEl.querySelector(".article");
  if (!article) return;
  const pitch = pageW + GUTTER;
  article.style.setProperty("--spread-x", `-${spread * 2 * pitch}px`);

  const left = spread * 2 + 1;
  const right = Math.min(spread * 2 + 2, totalPages);
  if (pageCurEl) pageCurEl.textContent = left === right ? `${left}` : `${left}–${right}`;
  if (pageTotalEl) pageTotalEl.textContent = `${totalPages}`;
  if (prevBtn) prevBtn.disabled = spread <= 0;
  if (nextBtn) nextBtn.disabled = spread >= totalSpreads - 1;
}

// ===== Highlight color + opacity (drives --hl-color / --hl-op on :root) =====

function wireHighlightPopup() {
  const hlTool = document.getElementById("hl-tool");
  const popup = document.getElementById("color-popup");
  hlTool?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popup) popup.hidden = !popup.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!popup || popup.hidden) return;
    if (popup.contains(e.target) || hlTool?.contains(e.target)) return;
    popup.hidden = true;
  });

  popup?.querySelectorAll(".sw").forEach((sw) => {
    sw.addEventListener("click", () => {
      popup.querySelectorAll(".sw").forEach((s) => s.classList.remove("is-on"));
      sw.classList.add("is-on");
      document.documentElement.style.setProperty("--hl-color", sw.dataset.color);
    });
  });

  const slider = document.getElementById("op-slider");
  const label = document.getElementById("op-val");
  slider?.addEventListener("input", () => {
    document.documentElement.style.setProperty("--hl-op", (slider.value / 100).toFixed(2));
    if (label) label.textContent = `${slider.value}%`;
  });
}

// ===== Left source drawer + top menu + dashboard flyout =====

function wireMenusAndDrawer() {
  const sidebarEl = document.getElementById("sidebar");
  const handle = document.getElementById("drawer-handle");
  const openDrawer = () => document.body.classList.add("drawer-open");
  const toggleDrawer = () => document.body.classList.toggle("drawer-open");

  document.body.classList.add("drawer-open"); // default expanded
  handle?.addEventListener("click", toggleDrawer);
  document.getElementById("open-sources")?.addEventListener("click", toggleDrawer);
  document.getElementById("menu-open")?.addEventListener("click", openDrawer);
  document.getElementById("menu-saved")?.addEventListener("click", () => {
    openDrawer();
    sidebarEl
      ?.querySelector("#ext-saved-head")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Dashboard stays a right flyout, toggled from the rail or the 기록 menu item.
  const dashboardEl = document.getElementById("dashboard");
  const recordsBtn = document.getElementById("btn-records");
  const recordsMenu = document.getElementById("menu-records");
  const toggleDash = (e) => {
    e?.stopPropagation?.();
    dashboardEl?.classList.toggle("as-flyout");
  };
  recordsBtn?.addEventListener("click", toggleDash);
  recordsMenu?.addEventListener("click", toggleDash);
  document.addEventListener("click", (e) => {
    if (!dashboardEl?.classList.contains("as-flyout")) return;
    if (
      dashboardEl.contains(e.target) ||
      recordsBtn?.contains(e.target) ||
      recordsMenu?.contains(e.target)
    )
      return;
    dashboardEl.classList.remove("as-flyout");
  });
}

// ===== Body text size =====

function wireFontSize() {
  const dec = document.getElementById("font-dec");
  const inc = document.getElementById("font-inc");
  let scale = parseFloat(localStorage.getItem("layer2.fontscale")) || 1;
  const apply = () => {
    scale = Math.min(1.6, Math.max(0.8, scale));
    document.documentElement.style.setProperty("--reader-scale", scale.toFixed(2));
    try {
      localStorage.setItem("layer2.fontscale", String(scale));
    } catch {
      /* best-effort */
    }
    relayoutViewer();
  };
  dec?.addEventListener("click", () => {
    scale -= 0.1;
    apply();
  });
  inc?.addEventListener("click", () => {
    scale += 0.1;
    apply();
  });
  apply();
}

// ===== Bookmark / capture (push the same signals the old toolbar did) =====

function wireActionButtons() {
  const bookmark = document.getElementById("btn-bookmark");
  const capture = document.getElementById("btn-capture");
  bookmark?.addEventListener("click", () => {
    pushSignal({
      type: "bookmark",
      paragraph_ids: visibleParagraphIds(),
      scroll_y: readerEl.scrollTop,
    });
    flash(bookmark);
  });
  capture?.addEventListener("click", () => {
    pushSignal({
      type: "capture",
      paragraph_ids: visibleParagraphIds(),
      scroll_y: readerEl.scrollTop,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    });
    flash(capture);
  });
}

// Paragraphs currently inside the stage's visible box (works for both the
// scroll viewport and the translated book spread).
function visibleParagraphIds() {
  const box = stageEl.getBoundingClientRect();
  const out = [];
  for (const p of document.querySelectorAll("[data-paragraph-id]")) {
    const r = p.getBoundingClientRect();
    const visible = r.bottom > box.top && r.top < box.bottom && r.right > box.left && r.left < box.right;
    if (visible) out.push(p.dataset.paragraphId);
  }
  return out;
}

function flash(el) {
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 240);
}
