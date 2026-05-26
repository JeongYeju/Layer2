// app.js — entry point (branch: claude/viewer-layout).
// New chrome/layout (scroll vs paper-book spread) with the existing features
// wired in: drag-to-underline highlighting (+ color/opacity from the popup),
// signal recording (dwell/scroll/reread/trail/bookmark/capture), attention
// blur, and the signal dashboard (opened from the 기록 button).
//
// The portal reading-mode cursor is intentionally left out here — it is coupled
// to window scrolling, which this layout replaces with an internal #reader
// scroller and a transform-based spread.

import { renderReader } from "./reader.js";
import { initHighlight } from "./highlight.js";
import { initSidebar } from "./sidebar.js";
import { initBaselineCollectors } from "./signals.js";
import { initAttention, wakeReading } from "./attention.js";
import { renderDashboard } from "./dashboard.js";
import { initViewerShell, relayoutViewer } from "./viewer-shell.js";

// The mouse-trail visual reads window.__portal; provide a neutral stub since
// the portal cursor isn't wired on this branch.
window.__portal = window.__portal || { locked: false, x: 0, y: 0, actualY: 0 };

const reader = document.getElementById("reader");
const dashboard = document.getElementById("dashboard");

initHighlight();
initAttention({ readerEl: reader });
renderDashboard(dashboard);
initViewerShell();

let currentSource = null;

function setSource(source) {
  currentSource = source;
  renderReader(reader, source);
  initBaselineCollectors({ readerEl: reader }); // rebinds dwell to new paragraphs
  wakeReading();
  // Spread pagination depends on the rendered DOM + final font metrics.
  if (document.fonts?.ready) document.fonts.ready.then(relayoutViewer);
  requestAnimationFrame(() => requestAnimationFrame(relayoutViewer));
}

// initSidebar seeds the reader (sample / persisted / extension-injected source)
// via onSelect. Its panel opens as a flyout from "모든 도구".
initSidebar({ onSelect: setSource, initialSource: window.__layer2InjectedSource });

window.__currentSource = () => currentSource;
