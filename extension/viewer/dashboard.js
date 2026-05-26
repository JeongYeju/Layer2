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
  "circle_gesture",
]);

let metricsRoot, recentRoot, timelineRoot, interpRoot;

export function renderDashboard(rootEl) {
  rootEl.innerHTML = `
    <h2>AI 해석 <button type="button" id="interp-load" class="interp-load-btn">불러오기</button></h2>
    <div id="m-interpretation" class="interp">
      <div class="interp-empty">interpret.py 결과 JSON을 불러오면 여기에 표시됩니다.</div>
    </div>
    <input type="file" id="interp-file" accept="application/json,.json" hidden />

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
  interpRoot = rootEl.querySelector("#m-interpretation");
  wireInterpLoader(rootEl);

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
  c.title = chipTooltip(sig);
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
      return `🔖 ${formatParaRange(sig.paragraph_ids)}`;
    case "capture":
      return `📷 ${formatParaRange(sig.paragraph_ids)}`;
    case "highlight_underline":
      return `밑줄 ${sig.text_length}자`;
    case "highlight_annotation":
      return `주석 "${truncate(sig.annotation_text, 8)}"`;
    case "circle_gesture":
      if (sig.enclosed_text) {
        return `◯ "${truncate(sig.enclosed_text, 10)}"`;
      }
      return `◯ r${sig.radius}px`;
    default:
      return sig.type;
  }
}

// "p1", "p2", "p3" → "p1–p3"; single → "p2"; empty → "viewport"
function formatParaRange(ids) {
  if (!ids || ids.length === 0) return "viewport";
  if (ids.length === 1) return ids[0];
  return `${ids[0]}–${ids[ids.length - 1]}`;
}

function chipTooltip(sig) {
  const baseT = `@${Math.round(sig.t)}ms`;
  if (sig.type === "capture" || sig.type === "bookmark") {
    const ids = (sig.paragraph_ids || []).join(", ") || "(none visible)";
    const scroll = `scroll ${Math.round(sig.scroll_y || 0)}px`;
    const vp = sig.viewport
      ? ` · ${sig.viewport.w}×${sig.viewport.h}`
      : "";
    return `${sig.type}: ${ids} · ${scroll}${vp} ${baseT}`;
  }
  if (sig.type === "circle_gesture") {
    const enc = sig.enclosed_text
      ? `"${sig.enclosed_text}" (${sig.enclosed_paragraph || "?"})`
      : "(no words)";
    return `circle: ${enc} · r${sig.radius}px ${baseT}`;
  }
  return `${sig.type} ${baseT}`;
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

// ---------- Phase 2.3: AI interpretation panel ----------
// Loads a scripts/interpret.py result JSON and renders it. The LLM block
// (interpretation) is shown when present; otherwise we fall back to the
// always-available refined digest so loading is useful even offline.

function wireInterpLoader(rootEl) {
  const btn = rootEl.querySelector("#interp-load");
  const file = rootEl.querySelector("#interp-file");
  if (!btn || !file) return;
  btn.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    try {
      const result = JSON.parse(await f.text());
      renderInterpretation(result);
    } catch (err) {
      interpRoot.innerHTML = `<div class="interp-note">불러오기 실패: ${escapeHtml(String(err.message || err))}</div>`;
    }
  });
}

function renderInterpretation(result) {
  if (!result || (!result.interpretation && !result.refined)) {
    interpRoot.innerHTML = `<div class="interp-note">interpret.py 결과 형식이 아닙니다.</div>`;
    return;
  }
  const parts = [metaLine(result)];
  const interp = result.interpretation;

  if (interp && (interp.summary || interp.paused_at || interp.stuck_at)) {
    if (interp.engagement) {
      parts.push(
        `<div><span class="interp-badge ${engagementClass(interp.engagement)}">몰입 ${escapeHtml(interp.engagement)}</span></div>`,
      );
    }
    if (interp.summary) {
      parts.push(`<div class="interp-summary">${escapeHtml(interp.summary)}</div>`);
    }
    parts.push(findingSection("멈춘 곳", interp.paused_at, "why"));
    parts.push(findingSection("막힌 곳", interp.stuck_at, "evidence"));
    if (interp.interests?.length) {
      parts.push(`<div class="interp-subhead">관심사</div>`);
      parts.push(
        `<div class="interp-interests">${interp.interests
          .map((i) => `<span class="interp-interest">${escapeHtml(i)}</span>`)
          .join("")}</div>`,
      );
    }
    if (interp.notes) {
      parts.push(`<div class="interp-note">${escapeHtml(interp.notes)}</div>`);
    }
  } else if (interp && interp.raw) {
    // LLM replied but the JSON couldn't be parsed — show raw text.
    parts.push(`<pre class="interp-raw">${escapeHtml(interp.raw)}</pre>`);
  } else {
    // No LLM interpretation (e.g. --no-llm) — fall back to refined digest.
    if (result.interpretation_note) {
      parts.push(`<div class="interp-note">${escapeHtml(result.interpretation_note)}</div>`);
    }
    parts.push(refinedFallback(result.refined));
  }

  interpRoot.innerHTML = parts.filter(Boolean).join("");
  interpRoot.querySelectorAll("li[data-pid]").forEach((li) => {
    li.addEventListener("click", () => scrollToPara(li.dataset.pid));
  });
}

function metaLine(result) {
  const bits = [];
  if (result.source?.title) bits.push(result.source.title);
  if (result.session?.duration_ms != null) {
    bits.push(`${Math.round(result.session.duration_ms / 1000)}s`);
  }
  if (result.session?.signal_count != null) {
    bits.push(`${result.session.signal_count} signals`);
  }
  return `<div class="interp-meta">${escapeHtml(bits.join(" · "))}</div>`;
}

function findingSection(label, items, whyKey) {
  if (!items?.length) return "";
  const lis = items
    .map((it) => {
      const pid = it.paragraph_id || "";
      const why = it[whyKey] || "";
      return `<li${pid ? ` data-pid="${escapeHtml(pid)}"` : ""}>
        <div class="interp-finding-text">${escapeHtml(it.text || "")}</div>
        ${why ? `<div class="interp-finding-why">${escapeHtml(why)}</div>` : ""}
        ${pid ? `<span class="interp-pid">${escapeHtml(pid)} ↗</span>` : ""}
      </li>`;
    })
    .join("");
  return `<div class="interp-subhead">${label}</div><ul class="interp-findings">${lis}</ul>`;
}

function refinedFallback(refined) {
  if (!refined) return "";
  const paras = (refined.paragraphs || [])
    .filter((p) => p.dwell_ms > 0 || p.reread_count > 0)
    .sort((a, b) => b.dwell_ms - a.dwell_ms)
    .slice(0, 5);
  const lis = paras
    .map((p) => {
      const meta = [`${Math.round(p.dwell_ms / 1000)}s 머묾`];
      if (p.reread_count) meta.push(`${p.reread_count}회 다시읽기`);
      if (p.highlights.length) meta.push(`밑줄 ${p.highlights.length}`);
      return `<li data-pid="${escapeHtml(p.id)}">
        <div class="interp-finding-text">${escapeHtml(p.text_preview || "")}</div>
        <div class="interp-finding-why">${escapeHtml(meta.join(" · "))}</div>
        <span class="interp-pid">${escapeHtml(p.id)} ↗</span>
      </li>`;
    })
    .join("");
  const body = lis
    ? `<ul class="interp-findings">${lis}</ul>`
    : `<div class="interp-note">집계할 읽기 활동이 없습니다.</div>`;
  return `<div class="interp-subhead">가장 오래 머문 문단 (refined)</div>${body}`;
}

function engagementClass(level) {
  const l = String(level).toLowerCase();
  return l === "high" || l === "medium" || l === "low" ? l : "low";
}

function scrollToPara(pid) {
  if (!pid) return;
  let el;
  try {
    el = document.querySelector(`[data-paragraph-id="${CSS.escape(pid)}"]`);
  } catch {
    el = null;
  }
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("para-flash");
  setTimeout(() => el.classList.remove("para-flash"), 1500);
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
