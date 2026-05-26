// app.js — entry point. Wire modules in order.

import { renderReader } from "./reader.js";
import { initBaselineCollectors } from "./signals.js";
import { renderToolbar } from "./toolbar.js";
import { renderDashboard } from "./dashboard.js";
import { initHighlight } from "./highlight.js";
import { initCursorHud } from "./cursor-hud.js"; // tuning panel — remove this line + cursor-hud.js when done
import { initPortal } from "./portal.js";
import { initSidebar } from "./sidebar.js";

const reader = document.getElementById("reader");
const dashboard = document.getElementById("dashboard");
const toolbar = document.getElementById("toolbar");

// Persistent UI — wired once, listens to the global signalBus from then on.
renderToolbar(toolbar);
renderDashboard(dashboard);
initHighlight();
initCursorHud();
initPortal();

// Source switching: every time the user picks a different source from the
// sidebar we (a) re-render the reader DOM and (b) re-attach the baseline
// signal collectors that observe the new paragraph elements. Everything
// else (highlight, portal, cursor-hud, dashboard) listens via document /
// signalBus and survives the swap unchanged.
let currentSource = null;

// Per-source scroll position, persisted so reopening a source (or reloading)
// lands where the reader left off. Keyed by source id.
const SCROLL_KEY = "layer2.scroll.v1";

function loadScrollMap() {
  try {
    return JSON.parse(localStorage.getItem(SCROLL_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveScrollPos() {
  if (!currentSource) return;
  const map = loadScrollMap();
  map[currentSource.id] = Math.round(window.scrollY);
  try {
    localStorage.setItem(SCROLL_KEY, JSON.stringify(map));
  } catch {
    /* best-effort */
  }
}

let lastScrollSaveT = 0;
window.addEventListener(
  "scroll",
  () => {
    // Don't record the virtual reading-mode cursor's scroll syncing as intent.
    if (window.__portal?.locked) return;
    const now = Date.now();
    if (now - lastScrollSaveT < 400) return;
    lastScrollSaveT = now;
    saveScrollPos();
  },
  { passive: true },
);

function setSource(source) {
  currentSource = source;
  renderReader(reader, source);
  initBaselineCollectors({ readerEl: reader });
  // Restore scroll once layout has settled (reader renders text synchronously,
  // but pretext/fonts finish a tick later). Falls back to top for new sources.
  const y = loadScrollMap()[source.id];
  if (typeof y === "number" && y > 0) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => window.scrollTo(0, y)),
    );
  } else {
    window.scrollTo(0, 0);
  }
}

// initSidebar fires onSelect once on boot so the reader starts populated.
// window.__layer2InjectedSource is set by the extension's boot shim before
// app.js loads; in the standalone viewer it's undefined and we seed the sample.
initSidebar({ onSelect: setSource, initialSource: window.__layer2InjectedSource });

// Expose for ad-hoc inspection.
window.__currentSource = () => currentSource;
