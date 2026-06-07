// app.js — entry point (branch: claude/viewer-layout).
// New chrome/layout (scroll vs paper-book spread) with the existing features
// wired in: drag-to-underline highlighting (+ color/opacity from the popup),
// signal recording (dwell/scroll/reread/trail/bookmark/capture), attention
// blur, the signal dashboard (기록 button), and the portal reading-mode cursor
// (독서 모드 rail button), retargeted to scroll inside #reader.

import { renderReader } from "./reader.js";
import { initHighlight } from "./highlight.js";
import { initSidebar } from "./sidebar.js";
import { initBaselineCollectors } from "./signals.js";
import { initAttention, wakeReading } from "./attention.js";
import { renderDashboard } from "./dashboard.js";
import { initPortal } from "./portal.js";
import { initViewerShell, relayoutViewer, flipSpread } from "./viewer-shell.js";
import { initCandle, resetCandle } from "./candle.js";
import { initChat } from "./chat.js";

const reader = document.getElementById("reader");
const dashboard = document.getElementById("dashboard");

initHighlight();
initAttention({ readerEl: reader });
initCandle({ readerEl: reader });
initChat();
renderDashboard(dashboard);
initViewerShell();
// Reading mode rides #reader's scroll (and flips pages in spread) and toggles
// from the 독서 모드 rail button.
initPortal({
  scrollEl: reader,
  triggerEl: document.getElementById("reading-mode"),
  onPageFlip: flipSpread,
});

let currentSource = null;

function setSource(source) {
  currentSource = source;
  renderReader(reader, source);
  initBaselineCollectors({ readerEl: reader }); // rebinds dwell to new paragraphs
  resetCandle();
  wakeReading();
  // Spread pagination depends on the rendered DOM + final font metrics.
  if (document.fonts?.ready) document.fonts.ready.then(relayoutViewer);
  requestAnimationFrame(() => requestAnimationFrame(relayoutViewer));
}

// initSidebar seeds the reader (sample / persisted / extension-injected source)
// via onSelect. Its panel opens as a flyout from "모든 도구".
initSidebar({ onSelect: setSource, initialSource: window.__layer2InjectedSource });

window.__currentSource = () => currentSource;
