// viewer-shell.js — experimental viewer chrome (branch: claude/viewer-layout).
// Wires the layout toggle (infinite scroll ↔ paper-book spread), spread
// pagination (columnize the article, translateX to flip pages), the page nav,
// the highlight color/opacity popup, the source + dashboard flyouts, and the
// bookmark / capture signal buttons. Icons are Lucide (rendered on init).

import { pushSignal } from "./signals.js";

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

  // Render the static Lucide <i data-lucide> placeholders into SVGs.
  window.lucide?.createIcons();

  wireLayoutToggle();
  wirePageNav();
  wireHighlightPopup();
  wireFlyouts();
  wireActionButtons();

  let rt = 0;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(relayoutViewer, 150);
  });

  const saved = localStorage.getItem(MODE_KEY);
  setMode(saved === "spread" ? "spread" : "scroll");
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
  mode = m === "spread" ? "spread" : "scroll";
  readerEl.classList.toggle("mode-spread", mode === "spread");
  readerEl.classList.toggle("mode-scroll", mode === "scroll");
  toggleEl?.querySelectorAll("button[data-mode]").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.mode === mode),
  );
  if (pagenavEl) pagenavEl.hidden = mode !== "spread";
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* best-effort */
  }
  if (mode === "scroll") {
    const a = readerEl.querySelector(".article");
    if (a) a.style.removeProperty("--spread-x");
  }
  spread = 0;
  relayoutViewer();
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

// ===== Source + dashboard flyouts =====

function wireFlyouts() {
  const openSourcesBtn = document.getElementById("open-sources");
  const sidebarEl = document.getElementById("sidebar");
  const recordsBtn = document.getElementById("btn-records");
  const dashboardEl = document.getElementById("dashboard");

  bindFlyout(openSourcesBtn, sidebarEl);
  bindFlyout(recordsBtn, dashboardEl);
}

function bindFlyout(btn, panel) {
  if (!btn || !panel) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("as-flyout");
  });
  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("as-flyout")) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    panel.classList.remove("as-flyout");
  });
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
