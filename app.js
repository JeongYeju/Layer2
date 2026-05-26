// app.js — entry point (branch: claude/viewer-layout).
// Experimental viewer shell: render content + drag-to-underline highlighting +
// the new chrome/layout toggle. The portal reading-mode cursor, attention blur,
// dashboard, floating toolbar and tuning HUD are intentionally not wired here —
// this branch is a "looks first" layout prototype (scroll vs paper-book spread).

import { renderReader } from "./reader.js";
import { initHighlight } from "./highlight.js";
import { initSidebar } from "./sidebar.js";
import { initViewerShell, relayoutViewer } from "./viewer-shell.js";

const reader = document.getElementById("reader");

initHighlight();
initViewerShell();

let currentSource = null;

function setSource(source) {
  currentSource = source;
  renderReader(reader, source);
  // Spread pagination depends on the rendered DOM + final font metrics.
  if (document.fonts?.ready) document.fonts.ready.then(relayoutViewer);
  requestAnimationFrame(() => requestAnimationFrame(relayoutViewer));
}

// initSidebar seeds the reader (sample / persisted / extension-injected source)
// via onSelect. Its panel is hidden in this layout, but it still loads content.
initSidebar({ onSelect: setSource, initialSource: window.__layer2InjectedSource });

window.__currentSource = () => currentSource;
