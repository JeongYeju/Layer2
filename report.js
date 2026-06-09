// report.js — Micro 리포트: "Mental Model Map" (단일 소스, LLM 불필요)
//
// 독서 1회의 메타인지 지형도. refineExport(SignalLog) 의 단락별 friction·ICAP·
// 흔적을 읽어, 글을 읽어내려간 "척추(spine)" 위에 *치열하게 읽은 곳*과 *내가
// 내 말로 구성한 개념(주석)*을 노드로 세운다. 훑고 지나간 단락은 접는다.
// (보드 모드가 흔적의 "어디"라면, 리포트는 한 화면 요약 "무엇을 남겼나".)
//
// 이론: friction = 문서 내 percentile(상위20%), ICAP P<A<C<I (docs/theory-base.md).
// 데이터: highlight_underline/annotation, circle_gesture, chat_turn, recall_attempt.

import { buildSessionExport } from "./sidebar.js";
import { refineExport } from "./interpret.js";
import { signalBus } from "./signals.js";

const ICAP = {
  P: { label: "훑어봄", cls: "p" },
  A: { label: "표시", cls: "a" },
  C: { label: "구성", cls: "c" },
  I: { label: "대화", cls: "i" },
};

let hostEl = null;
let timer = null;

export function initReport({ mountEl }) {
  hostEl = mountEl;
  render();
  signalBus.addEventListener("signal", (e) => {
    const t = e.detail && e.detail.type;
    if (
      [
        "highlight_underline",
        "highlight_annotation",
        "circle_gesture",
        "chat_turn",
        "recall_attempt",
        "session_end",
      ].includes(t)
    ) {
      clearTimeout(timer);
      timer = setTimeout(render, 600);
    }
  });
  window.__layer2Report = { render };
}

function safeData() {
  try {
    const exp = buildSessionExport();
    if (!exp || !exp.source) return null;
    return { refined: refineExport(exp), source: exp.source };
  } catch {
    return null;
  }
}

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

function paraDomText(pid) {
  const el = document.querySelector(`[data-paragraph-id="${pid}"]`);
  if (!el) return "";
  const g = [...el.querySelectorAll("[data-char-index]")]
    .map((s) => s.textContent)
    .join("");
  return g || (el.textContent || "").trim();
}

function isNode(p) {
  return !!(
    p.friction_high ||
    (p.annotations && p.annotations.length) ||
    (p.highlights && p.highlights.length) ||
    (p.circles && p.circles.length) ||
    p.chat_turns > 0 ||
    p.icap_mode === "C" ||
    p.icap_mode === "I"
  );
}

function topPct(p) {
  return p.friction_pct != null
    ? Math.max(1, Math.round((1 - p.friction_pct) * 100))
    : null;
}

function render() {
  if (!hostEl) return;
  const data = safeData();
  const paras = data && data.refined && data.refined.paragraphs;
  if (!paras || !paras.length) {
    hostEl.innerHTML = `<div class="report-empty">아직 읽은 흔적이 없어요. 글을 읽으면 여기에 <b>멘탈 모델 맵</b>이 그려집니다.<br><span class="report-demo">데모: <code>__layer2Demo.seed()</code></span></div>`;
    return;
  }
  hostEl.innerHTML = build(data.refined);
  hostEl.querySelectorAll("[data-pid]").forEach((el) => {
    el.addEventListener("click", () => scrollToPara(el.dataset.pid));
  });
}

function build(refined) {
  const paras = refined.paragraphs;
  const counts = refined.counts || {};
  const hot = paras.filter((p) => p.friction_high).length;
  const tally = { P: 0, A: 0, C: 0, I: 0 };
  for (const p of paras) tally[(p.icap_mode || "P").toUpperCase()]++;
  const total = paras.length || 1;

  // 내가 내 말로 구성한 개념 = 주석(Constructive output)
  const concepts = [];
  for (const p of paras)
    for (const a of p.annotations || [])
      if ((a.note || "").trim()) concepts.push({ pid: p.id, on: a.on, note: a.note });

  // 한 줄 진단 — 지배적 양상
  const verdict = diagnose(paras, tally, hot, counts);

  // ── 헤더 요약 ──
  const icapBar = ["I", "C", "A", "P"]
    .filter((k) => tally[k] > 0)
    .map(
      (k) =>
        `<span class="rp-bar-seg rp-icap--${ICAP[k].cls}" style="flex:${tally[k]}" title="${ICAP[k].label} ${tally[k]}"></span>`,
    )
    .join("");
  const chips = [
    counts.highlight_underline
      ? `<span class="rp-stat">﹏ 밑줄 ${counts.highlight_underline}</span>`
      : "",
    counts.highlight_annotation
      ? `<span class="rp-stat">✎ 주석 ${counts.highlight_annotation}</span>`
      : "",
    counts.circle_gesture
      ? `<span class="rp-stat">◯ 표시 ${counts.circle_gesture}</span>`
      : "",
    counts.chat_turn ? `<span class="rp-stat">💬 대화 ${counts.chat_turn}</span>` : "",
    counts.recall_attempt
      ? `<span class="rp-stat">🧠 회상 ${counts.recall_attempt}</span>`
      : "",
    hot ? `<span class="rp-stat rp-stat--hot">마찰 상위 ${hot}곳</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  // ── 척추(spine) — 노드 + 훑은 구간 접기 ──
  const items = [];
  let skim = 0;
  const flushSkim = () => {
    if (skim > 0) {
      items.push(
        `<li class="rp-skim"><span class="rp-dot rp-dot--faint"></span><span class="rp-skim-label">⋯ ${skim}단락 훑어봄</span></li>`,
      );
      skim = 0;
    }
  };
  for (const p of paras) {
    if (!isNode(p)) {
      skim++;
      continue;
    }
    flushSkim();
    items.push(nodeHTML(p));
  }
  flushSkim();

  return `
    <div class="rp-verdict">${esc(verdict)}</div>
    <div class="rp-summary">
      <div class="rp-icap-bar">${icapBar || '<span class="rp-bar-seg rp-icap--p" style="flex:1"></span>'}</div>
      <div class="rp-stats">${chips || '<span class="rp-stat">아직 흔적 없음</span>'}</div>
    </div>
    <ol class="rp-spine">${items.join("")}</ol>
    ${
      concepts.length
        ? `<div class="rp-concepts">
            <div class="rp-concepts-head">내가 내 말로 구성한 개념 <span class="rp-concepts-n">${concepts.length}</span></div>
            ${concepts
              .map(
                (c) =>
                  `<div class="rp-concept" data-pid="${c.id || c.pid}">${
                    c.on ? `<span class="rp-concept-on">${esc(c.on)}</span>` : ""
                  }<span class="rp-concept-note">${esc(c.note)}</span></div>`,
              )
              .join("")}
          </div>`
        : ""
    }`;
}

function nodeHTML(p) {
  const icap = ICAP[(p.icap_mode || "P").toUpperCase()] || ICAP.P;
  const pct = topPct(p);
  const note = p.annotations && p.annotations[0] && p.annotations[0].note;
  const hl = p.highlights && p.highlights[0];
  const fallback = paraDomText(p.id).slice(0, 46);
  const anchor = (note || hl || fallback || "").trim();
  const ellipsis = !note && !hl && fallback.length >= 46 ? "…" : "";
  const traces = [
    p.highlights && p.highlights.length
      ? `<span class="rp-trace">﹏ ${p.highlights.length}</span>`
      : "",
    p.chat_turns > 0 ? `<span class="rp-trace">💬 ${p.chat_turns}</span>` : "",
    p.circles && p.circles.length
      ? `<span class="rp-trace">◯ ${p.circles.length}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");
  return `<li class="rp-node ${p.friction_high ? "is-hot" : ""}" data-pid="${p.id}">
    <span class="rp-dot"></span>
    <div class="rp-card">
      <div class="rp-card-head">
        <span class="rp-icap rp-icap--${icap.cls}">${icap.label}</span>
        ${p.friction_high ? `<span class="rp-hot">마찰 상위 ${pct ? pct + "%" : "20%"}</span>` : ""}
      </div>
      <div class="rp-anchor">${esc(anchor)}${ellipsis}</div>
      ${note ? `<div class="rp-note">✎ ${esc(note)}</div>` : ""}
      ${traces ? `<div class="rp-traces">${traces}</div>` : ""}
    </div>
  </li>`;
}

// 행동 증거를 한 줄 진단으로 압축(절대 분류기 아님 — 경향 요약).
function diagnose(paras, tally, hot, counts) {
  if (!counts.dwell && !counts.highlight_underline && !counts.highlight_annotation) {
    return "이제 막 읽기 시작했어요. 조금 더 읽으면 지도가 또렷해집니다.";
  }
  const constructive = tally.C + tally.I;
  if (constructive >= 2 && hot >= 1) {
    return "치열하게 읽은 구간에서 *내 말로 다시 쓰며* 깊이 들어갔어요 — 생산적 씨름(germane).";
  }
  if (hot >= 2 && constructive === 0) {
    return "오래 붙잡았지만 산출물이 적은 구간이 있어요 — 막혔던 곳을 다시 보면 좋아요.";
  }
  if (tally.A > constructive && tally.A > 0) {
    return "표시(밑줄·동그라미) 위주로 읽었어요. 한 곳을 골라 *내 말로* 적어보면 내재화가 깊어집니다.";
  }
  return "고르게 읽어내려갔어요. 마찰이 높은 곳을 거점으로 다시 보면 지도가 단단해집니다.";
}

function scrollToPara(pid) {
  const el = document.querySelector(`[data-paragraph-id="${pid}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("para-flash");
  setTimeout(() => el.classList.remove("para-flash"), 1500);
}
