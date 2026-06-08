// dashboard.js
// Right-side panel that listens to signalBus and aggregates view-state.

import { signalBus, SignalLog } from "./signals.js";
import { buildSessionExport } from "./sidebar.js";
import { interpretSession } from "./interpret.js";
import { loadSessions, summarizeMacro } from "./sessions.js";

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

let metricsRoot, recentRoot, timelineRoot, interpRoot, sessionsRoot;

export function renderDashboard(rootEl) {
  rootEl.innerHTML = `
    <h2>다중 세션</h2>
    <div id="m-sessions" class="sessions"></div>

    <h2>AI 해석
      <button type="button" id="interp-run" class="interp-load-btn">해석하기</button>
      <button type="button" id="interp-load" class="interp-load-btn">불러오기</button>
    </h2>
    <div class="interp-settings">
      <select id="interp-provider" class="interp-provider">
        <option value="anthropic">Anthropic</option>
        <option value="openai">OpenAI</option>
        <option value="gemini">Gemini</option>
      </select>
      <input type="password" id="interp-key" class="interp-key"
        placeholder="API 키 (이 브라우저에만 저장)" autocomplete="off" />
    </div>
    <div id="m-interpretation" class="interp">
      <div class="interp-empty">"해석하기"로 지금 세션을 분석하거나, interpret.py 결과 JSON을 불러오세요.</div>
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
  sessionsRoot = rootEl.querySelector("#m-sessions");
  wireInterpLoader(rootEl);
  wireInterpRunner(rootEl);

  signalBus.addEventListener("signal", (e) => onSignal(e.detail));

  // Replay anything already in the log (defensive — usually empty).
  for (const s of SignalLog) onSignal(s);

  paint();
  renderSessions();
}

function onSignal(sig) {
  // Only the cases below change the metric panels. High-frequency signals
  // (mouse_trail ~8/s, scroll) must NOT trigger a full innerHTML rebuild, or
  // the panel churns/flickers continuously while the mouse moves.
  let statsChanged = true;
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
    case "session_end":
      // sessions.js saves the summary on the same event; re-render shortly after.
      setTimeout(renderSessions, 30);
      statsChanged = false; // metrics unchanged — only the sessions panel.
      break;
    default:
      statsChanged = false; // mouse_trail, scroll, candle_*, chat_*, etc.
  }

  if (TIMELINE_TYPES.has(sig.type)) appendChip(sig);
  if (statsChanged) paint();
}

// ===== Multi-session macro report =====
function renderSessions() {
  if (!sessionsRoot) return;
  const sessions = loadSessions();
  if (!sessions.length) {
    sessionsRoot.innerHTML = `<div class="interp-note">아직 누적된 세션이 없어요. 글을 읽고 '독서 종료'를 하면 쌓입니다.<br>데모: <code>__layer2Demo.seedSessions()</code></div>`;
    return;
  }
  const m = summarizeMacro(sessions);
  const parts = [];
  parts.push(
    `<div class="sess-total">${m.n}개 세션 · 총 ${Math.round(m.totalMs / 60000)}분 읽음</div>`,
  );
  parts.push(`<div class="interp-subhead">시간대별 인지 리듬</div>`);
  parts.push(hourBuckets(m.byHour));
  parts.push(`<div class="interp-subhead">마찰 추이 (세션 순)</div>`);
  parts.push(sparkline(m.trend.map((x) => x.mean)));
  parts.push(`<div class="interp-subhead">관심사</div>`);
  parts.push(
    `<div class="interp-interests">${Object.entries(m.titles)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t, c]) => `<span class="interp-interest">${escapeHtml(t)}${c > 1 ? ` ×${c}` : ""}</span>`)
      .join("")}</div>`,
  );
  parts.push(`<div class="interp-subhead">최근 세션</div>`);
  parts.push(
    `<ul class="interp-findings">${sessions
      .slice(-6)
      .reverse()
      .map(
        (s) => `<li>
        <div class="interp-finding-text">${escapeHtml(s.source_title)}</div>
        <div class="interp-finding-why">${s.hour}시 · ${Math.round((s.duration_ms || 0) / 60000)}분 · 마찰 ${s.friction?.mean ?? 0} · I${s.icap?.I || 0}·C${s.icap?.C || 0}·A${s.icap?.A || 0}·P${s.icap?.P || 0}</div>
      </li>`,
      )
      .join("")}</ul>`,
  );
  sessionsRoot.innerHTML = parts.join("");
}

// 시간대 4구간 막대 — 길이=세션 수, 색 농도=평균 마찰 (딥리딩 시간대일수록 진함).
function hourBuckets(byHour) {
  const buckets = [
    { label: "밤", hrs: [0, 1, 2, 3, 4, 5] },
    { label: "오전", hrs: [6, 7, 8, 9, 10, 11] },
    { label: "오후", hrs: [12, 13, 14, 15, 16, 17] },
    { label: "저녁", hrs: [18, 19, 20, 21, 22, 23] },
  ];
  const rows = buckets.map((b) => {
    let count = 0,
      fsum = 0;
    for (const h of b.hrs) {
      const x = byHour[h];
      if (x) {
        count += x.count;
        fsum += x.frictionSum;
      }
    }
    return { label: b.label, count, avg: count ? fsum / count : 0 };
  });
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  return `<div class="sess-bars">${rows
    .map(
      (r) => `<div class="sess-bar-row">
      <span class="sess-bar-label">${r.label}</span>
      <span class="sess-bar-track"><span class="sess-bar-fill" style="width:${Math.round((r.count / maxCount) * 100)}%;opacity:${(0.35 + Math.min(1, r.avg) * 0.65).toFixed(2)}"></span></span>
      <span class="sess-bar-val">${r.count}</span>
    </div>`,
    )
    .join("")}</div>`;
}

function sparkline(vals) {
  if (!vals.length) return "";
  const w = 240,
    h = 40,
    pad = 5;
  const min = Math.min(...vals),
    max = Math.max(...vals),
    range = max - min || 1;
  const pts = vals
    .map((v, i) => {
      const x = pad + (i / Math.max(1, vals.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / range) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="sess-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#b8442b" stroke-width="2" stroke-linejoin="round"/></svg>`;
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

// "해석하기" — build the current session digest and call the LLM in-browser,
// then render. Key + provider live in localStorage (this browser only).
function wireInterpRunner(rootEl) {
  const runBtn = rootEl.querySelector("#interp-run");
  const provider = rootEl.querySelector("#interp-provider");
  const keyInput = rootEl.querySelector("#interp-key");
  if (!runBtn || !provider || !keyInput) return;

  provider.value = localStorage.getItem("layer2.llm.provider") || "anthropic";
  keyInput.value = localStorage.getItem("layer2.llm.key") || "";
  const save = () => {
    try {
      localStorage.setItem("layer2.llm.provider", provider.value);
      localStorage.setItem("layer2.llm.key", keyInput.value.trim());
    } catch {
      /* best-effort */
    }
  };
  provider.addEventListener("change", save);
  keyInput.addEventListener("change", save);

  runBtn.addEventListener("click", async () => {
    const exportData = buildSessionExport();
    if (!exportData || !exportData.source) {
      interpRoot.innerHTML = `<div class="interp-note">해석할 독서 세션이 없습니다. 글을 조금 읽은 뒤 다시 시도하세요.</div>`;
      return;
    }
    save();
    const apiKey = keyInput.value.trim();
    runBtn.disabled = true;
    const label = runBtn.textContent;
    runBtn.textContent = "해석 중…";
    interpRoot.innerHTML = `<div class="interp-note">${apiKey ? "LLM 해석 중…" : "정제(digest) 생성 중…"}</div>`;
    try {
      const result = await interpretSession({ exportData, provider: provider.value, apiKey });
      renderInterpretation(result);
    } catch (err) {
      interpRoot.innerHTML = `<div class="interp-note">해석 실패: ${escapeHtml(String(err.message || err))}</div>`;
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = label;
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

  // 단락별 마찰 — interp(LLM) 유무와 무관하게 refined 에 friction 이 있으면 표시.
  parts.push(frictionSection(result.refined));

  // Board mode reads this to color paragraphs by friction. Best-effort.
  window.__lastInterpretation = result;

  interpRoot.innerHTML = parts.filter(Boolean).join("");
  interpRoot.querySelectorAll("li[data-pid]").forEach((li) => {
    li.addEventListener("click", () => scrollToPara(li.dataset.pid));
  });
}

// 단락별 인지 상태 — friction 계수 상위 문단을 ICAP/load 배지와 함께.
// (interpret.js computeFriction 산출. friction 없으면 섹션 숨김.)
function frictionSection(refined) {
  if (!refined) return "";
  const paras = (refined.paragraphs || [])
    .filter((p) => typeof p.friction === "number")
    .sort((a, b) => b.friction - a.friction)
    .slice(0, 5);
  if (!paras.length) return "";
  const lis = paras
    .map((p) => {
      const icap = p.icap_mode || "P";
      const load = p.load_tag || "";
      const pctTxt = p.friction_pct != null ? `${Math.round(p.friction_pct * 100)}%ile` : "";
      const badges = [
        `<span class="friction-badge icap-${icap.toLowerCase()}" title="ICAP engagement">${icap}</span>`,
        load ? `<span class="friction-badge load-${escapeHtml(load)}" title="cognitive load">${escapeHtml(load)}</span>` : "",
        p.friction_high ? `<span class="friction-badge friction-hot">상위20%</span>` : "",
      ].join("");
      return `<li data-pid="${escapeHtml(p.id)}">
        <div class="interp-finding-text">${escapeHtml(p.text_preview || "")}</div>
        <div class="interp-finding-why">마찰 ${p.friction.toFixed(1)} · ${pctTxt} ${badges}</div>
        <span class="interp-pid">${escapeHtml(p.id)} ↗</span>
      </li>`;
    })
    .join("");
  return `<div class="interp-subhead">단락별 인지 상태 (마찰 계수)</div><ul class="interp-findings">${lis}</ul>`;
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
