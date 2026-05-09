// dashboard.js
// Right-side panel that listens to signalBus and aggregates view-state.

import { signalBus, SignalLog } from "./signals.js";

const stats = {
  dwellCount: 0,
  rereadCount: 0,
  bookmarks: 0,
  captures: 0,
  underlines: 0,
  annotations: 0,
  totalDrawSpeed: 0,
  recentHighlights: [], // {text, t, paragraph_id, kind}
};

const TIMELINE_TYPES = new Set([
  "dwell",
  "reread",
  "bookmark",
  "capture",
  "highlight_underline",
  "highlight_annotation",
]);

let metricsRoot, recentRoot, timelineRoot;

export function renderDashboard(rootEl) {
  rootEl.innerHTML = `
    <h2>Reading</h2>
    <div id="m-reading"></div>

    <h2>하이라이트 활동</h2>
    <div id="m-highlight"></div>

    <h2>Recent highlights</h2>
    <ul id="recent-list" class="recent-list"></ul>

    <h2>Event timeline</h2>
    <div id="timeline" class="timeline"></div>
  `;

  metricsRoot = {
    reading: rootEl.querySelector("#m-reading"),
    highlight: rootEl.querySelector("#m-highlight"),
  };
  recentRoot = rootEl.querySelector("#recent-list");
  timelineRoot = rootEl.querySelector("#timeline");

  signalBus.addEventListener("signal", (e) => onSignal(e.detail));

  // Replay anything already in the log (defensive — usually empty).
  for (const s of SignalLog) onSignal(s);

  paint();
}

function onSignal(sig) {
  switch (sig.type) {
    case "dwell":
      stats.dwellCount++;
      break;
    case "reread":
      stats.rereadCount++;
      break;
    case "bookmark":
      stats.bookmarks++;
      break;
    case "capture":
      stats.captures++;
      break;
    case "highlight_underline":
      stats.underlines++;
      stats.totalDrawSpeed += sig.draw_speed || 0;
      addRecent({
        text: sig.selected_text,
        kind: "underline",
        paragraph_id: sig.paragraph_id,
        t: sig.t,
      });
      break;
    case "highlight_annotation":
      stats.annotations++;
      addRecent({
        text: `${sig.anchor_text} → "${sig.annotation_text}"`,
        kind: "annotation",
        paragraph_id: sig.paragraph_id,
        t: sig.t,
      });
      break;
  }

  if (TIMELINE_TYPES.has(sig.type)) appendChip(sig);
  paint();
}

function addRecent(item) {
  stats.recentHighlights.unshift(item);
  if (stats.recentHighlights.length > 5) stats.recentHighlights.length = 5;
}

function appendChip(sig) {
  const c = document.createElement("span");
  c.className = "chip";
  c.dataset.type = sig.type;
  c.textContent = chipLabel(sig);
  c.title = `${sig.type} @ ${Math.round(sig.t)}ms`;
  timelineRoot.appendChild(c);
  // keep timeline bounded
  while (timelineRoot.children.length > 80) {
    timelineRoot.removeChild(timelineRoot.firstChild);
  }
  timelineRoot.scrollTop = timelineRoot.scrollHeight;
}

function chipLabel(sig) {
  switch (sig.type) {
    case "dwell":
      return `dwell ${sig.duration_ms}ms`;
    case "reread":
      return `reread ${sig.paragraph_id}`;
    case "bookmark":
      return "bookmark";
    case "capture":
      return "capture";
    case "highlight_underline":
      return `밑줄 ${sig.text_length}자`;
    case "highlight_annotation":
      return `주석 "${truncate(sig.annotation_text, 8)}"`;
    default:
      return sig.type;
  }
}

function paint() {
  const transitionRate = stats.underlines
    ? Math.round((stats.annotations / stats.underlines) * 100)
    : 0;
  const avgSpeed = stats.underlines
    ? +(stats.totalDrawSpeed / stats.underlines).toFixed(1)
    : 0;

  metricsRoot.reading.innerHTML = `
    ${row("Dwell events", stats.dwellCount)}
    ${row("Reread events", stats.rereadCount)}
    ${row("Bookmarks", stats.bookmarks)}
    ${row("Captures", stats.captures)}
  `;

  metricsRoot.highlight.innerHTML = `
    ${row("밑줄 누적", stats.underlines)}
    ${row("평균 그리기 속도", avgSpeed ? `${avgSpeed} c/s` : "—")}
    ${row("주석 누적", stats.annotations)}
    ${row("밑줄→주석 전이율", `${transitionRate}%`)}
  `;

  recentRoot.innerHTML = stats.recentHighlights.length
    ? stats.recentHighlights
        .map(
          (r) => `
        <li>
          ${escapeHtml(truncate(r.text || "", 60))}
          <span class="meta">${r.kind} · ${r.paragraph_id}</span>
        </li>
      `,
        )
        .join("")
    : `<li style="border-left-color:transparent;color:var(--muted)">아직 없음</li>`;
}

function row(label, value) {
  return `<div class="metric"><span class="label">${label}</span><span class="value">${value}</span></div>`;
}
function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}
