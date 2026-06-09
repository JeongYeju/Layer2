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
let _edges = []; // 마지막 build 의 개념 엣지 [{a,b,w,title}]
let _ro = null; // ResizeObserver (숨김→보임 시 엣지 재측정)
let _semantic = false; // 현재 _edges 가 의미(임베딩) 기반인가
let _nodeTexts = []; // 노드별 원문(임베딩 입력)
let _semTimer = null;
let _semKey = ""; // 의미 엣지가 적용된 노드셋 시그니처(중복 호출 방지)
const _embCache = new Map(); // text → embedding vector (재임베딩 방지)

// ── 개념 엣지 (어휘 중첩) ──────────────────────────────────
// LLM/임베딩 없이, 단락 흔적(주석·밑줄·본문)의 *내용 단어 중첩* 으로 개념이
// 겹치는 노드를 잇는다. 의미 임베딩이 아니라 어휘 근사 — 정직하게 그렇게 라벨한다.
const RP_STOP = new Set(
  "그리고 그런데 하지만 그러나 그래서 또한 그러면 우리 너희 것 수 등 때 더 또 즉 이런 그런 저런 이것 그것 저것 무엇 어떤 매우 너무 정말 많은 모든 자꾸 가끔 종종 거의 다시 바로 그냥 위해 통해 대해 관해 만약 처럼 같은 같이 이다 있다 없다 한다 된다 하는 있는 없는 되는 자신 사람 경우 부분 생각 the and for that with this".split(
    /\s+/,
  ),
);
const RP_JOSA =
  /(으로서|으로써|에서는|에서|으로|로서|로써|에게|한테|에는|에도|에만|까지|부터|마다|이나|의|을|를|은|는|이|가|와|과|도|만|로|나|고|며|랑|이라|라|께|보다|처럼|같이|밖에)$/;

function contentTokens(text) {
  const out = new Map();
  for (const raw of String(text || "")
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/)) {
    if (!raw) continue;
    let t = /[가-힣]/.test(raw) ? raw.replace(RP_JOSA, "") : raw;
    if (t.length < 2 || RP_STOP.has(t)) continue;
    out.set(t, (out.get(t) || 0) + 1);
  }
  return out;
}

function computeEdges(nodeTokens) {
  const n = nodeTokens.length;
  if (n < 2) return [];
  const df = new Map();
  for (const m of nodeTokens) for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
  const maxDf = Math.max(2, Math.floor(n * 0.6)); // 거의 모든 노드에 있는 단어(제목어 등) 제외
  const idf = (t) => Math.log((n + 1) / (df.get(t) || 1));
  const cand = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const shared = [];
      let w = 0;
      for (const t of nodeTokens[i].keys()) {
        if (!nodeTokens[j].has(t) || (df.get(t) || 0) > maxDf) continue;
        shared.push(t);
        w += idf(t);
      }
      if (shared.length && w >= 0.6) {
        shared.sort((a, b) => (df.get(a) || 0) - (df.get(b) || 0));
        cand.push({ a: i, b: j, w, terms: shared.slice(0, 3) });
      }
    }
  }
  cand.sort((x, y) => y.w - x.w);
  const deg = new Array(n).fill(0);
  const edges = [];
  const cap = Math.min(cand.length, n + 4);
  for (const e of cand) {
    if (edges.length >= cap) break;
    if (deg[e.a] >= 2 || deg[e.b] >= 2) continue; // 노드당 최대 2 — 헤어볼 방지
    edges.push(e);
    deg[e.a]++;
    deg[e.b]++;
  }
  return edges;
}

// 노드 dot 의 y 좌표를 실측해 좌측 거터에 호(arc)로 잇는다. 패널이 숨겨져
// 있으면(크기 0) 그냥 빠지고, ResizeObserver 가 보일 때 다시 그린다.
function drawEdges() {
  if (!hostEl) return;
  const spine = hostEl.querySelector(".rp-spine");
  if (!spine) return;
  spine.querySelector(".rp-edges")?.remove();
  const legend = hostEl.querySelector(".rp-edges-legend");
  if (legend) {
    legend.textContent = _edges.length
      ? `곡선 = ${_semantic ? "의미가 가까운 단락 (임베딩)" : "개념이 겹치는 단락 (어휘 중첩)"} · ${_edges.length}`
      : "";
  }
  if (!_edges.length) return;
  const W = spine.clientWidth;
  const H = spine.scrollHeight;
  if (!W || !H) return; // 숨김 상태
  const yOf = new Map();
  for (const el of spine.querySelectorAll(".rp-node[data-ni]"))
    yOf.set(+el.dataset.ni, el.offsetTop + 9); // dot 중심 (top:4 + r:5)
  const X = 16;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "rp-edges");
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  const maxW = Math.max(..._edges.map((e) => e.w), 1);
  for (const e of _edges) {
    const y1 = yOf.get(e.a);
    const y2 = yOf.get(e.b);
    if (y1 == null || y2 == null) continue;
    const bulge = Math.min(13, 4 + Math.abs(y2 - y1) * 0.04);
    const cx = Math.max(2, X - bulge);
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", `M ${X} ${y1} Q ${cx} ${(y1 + y2) / 2} ${X} ${y2}`);
    path.setAttribute("class", "rp-edge");
    const s = e.w / maxW;
    path.setAttribute("stroke-width", (1 + s * 1.6).toFixed(2));
    path.style.opacity = (0.3 + s * 0.4).toFixed(2);
    const title = document.createElementNS(NS, "title");
    title.textContent = e.title || `공유 개념: ${(e.terms || []).join(", ")}`;
    path.appendChild(title);
    svg.appendChild(path);
  }
  spine.insertBefore(svg, spine.firstChild);
}

function scheduleEdges() {
  requestAnimationFrame(drawEdges);
  if (!_ro && typeof ResizeObserver !== "undefined" && hostEl) {
    _ro = new ResizeObserver(() => {
      requestAnimationFrame(drawEdges);
      maybeSemantic();
    });
    _ro.observe(hostEl);
  }
}

// ── 의미(임베딩) 엣지 — 키가 있으면 어휘 엣지를 *의미 유사*로 업그레이드 ──
// 동의어·의역으로 이어진 개념(공유 단어 0)도 잡는다. gemini-embedding-001 코사인.
// 비용 보호: 패널이 보일 때만 / 캐시(재임베딩 X) / 디바운스 / 노드셋 동일하면 skip.
function llmCreds() {
  return {
    provider: localStorage.getItem("layer2.llm.provider") || "anthropic",
    key: (localStorage.getItem("layer2.llm.key") || "").trim(),
  };
}

function reportVisible() {
  if (!hostEl) return false;
  const r = hostEl.getBoundingClientRect();
  return (
    r.width > 4 && r.height > 4 && r.left < window.innerWidth - 8 && r.right > 8
  );
}

function cosine(a, b) {
  let d = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

async function embedTexts(texts, key) {
  const need = [...new Set(texts.filter((t) => t && !_embCache.has(t)))];
  if (need.length) {
    const m = "gemini-embedding-001";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:batchEmbedContents`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: need.map((t) => ({
            model: `models/${m}`,
            content: { parts: [{ text: t.slice(0, 1000) }] },
          })),
        }),
      },
    );
    if (!res.ok) throw new Error("embed HTTP " + res.status);
    const j = await res.json();
    (j.embeddings || []).forEach((e, i) => {
      if (e && e.values) _embCache.set(need[i], e.values);
    });
  }
  return texts.map((t) => _embCache.get(t) || null);
}

function computeEdgesSemantic(vecs) {
  const n = vecs.length;
  const pairs = [];
  const sims = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (!vecs[i] || !vecs[j]) continue;
      const s = cosine(vecs[i], vecs[j]);
      pairs.push({ a: i, b: j, s });
      sims.push(s);
    }
  if (!pairs.length) return [];
  const mean = sims.reduce((x, y) => x + y, 0) / sims.length;
  const sd =
    Math.sqrt(sims.reduce((x, y) => x + (y - mean) ** 2, 0) / sims.length) || 0;
  // 이 임베딩 모델은 baseline 코사인이 높음 → 절대 바닥 + 문서 내 상대(평균+0.3σ).
  const thresh = Math.max(0.68, mean + 0.3 * sd);
  const cand = pairs.filter((p) => p.s >= thresh).sort((x, y) => y.s - x.s);
  const deg = new Array(n).fill(0);
  const edges = [];
  const cap = Math.min(cand.length, n + 4);
  for (const p of cand) {
    if (edges.length >= cap) break;
    if (deg[p.a] >= 2 || deg[p.b] >= 2) continue;
    edges.push({
      a: p.a,
      b: p.b,
      w: p.s,
      title: `의미 유사 ${Math.round(p.s * 100)}%`,
    });
    deg[p.a]++;
    deg[p.b]++;
  }
  return edges;
}

function maybeSemantic() {
  const { provider, key } = llmCreds();
  if (provider !== "gemini" || !key) return; // 키 없으면 어휘 엣지 그대로
  if (_nodeTexts.length < 2 || !reportVisible()) return;
  const sig = _nodeTexts.join("¶");
  if (sig === _semKey && _semantic) return; // 이미 이 노드셋으로 의미 엣지 적용됨
  clearTimeout(_semTimer);
  _semTimer = setTimeout(async () => {
    if (!reportVisible()) return;
    const texts = _nodeTexts.slice();
    const sig2 = texts.join("¶");
    try {
      const vecs = await embedTexts(texts, key);
      if (_nodeTexts.join("¶") !== sig2) return; // 그새 노드셋이 바뀌면 폐기
      const sem = computeEdgesSemantic(vecs);
      if (!sem.length) return; // 의미 엣지가 없으면 어휘 엣지 유지
      _edges = sem;
      _semantic = true;
      _semKey = sig2;
      drawEdges();
    } catch {
      /* 실패 시 어휘 엣지 유지 */
    }
  }, 1000);
}

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
    _edges = [];
    hostEl.innerHTML = `<div class="report-empty">아직 읽은 흔적이 없어요. 글을 읽으면 여기에 <b>멘탈 모델 맵</b>이 그려집니다.<br><span class="report-demo">데모: <code>__layer2Demo.seed()</code></span></div>`;
    return;
  }
  hostEl.innerHTML = build(data.refined);
  hostEl.querySelectorAll("[data-pid]").forEach((el) => {
    el.addEventListener("click", () => scrollToPara(el.dataset.pid));
  });
  scheduleEdges(); // 어휘 엣지(즉시) 그리기
  maybeSemantic(); // 키 있고 패널 보이면 의미(임베딩) 엣지로 업그레이드
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
  const nodeTokens = []; // 노드별 내용 단어 집합 → 어휘 엣지
  const nodeTexts = []; // 노드별 원문 → 의미(임베딩) 엣지
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
    const ni = nodeTokens.length;
    // 토큰 재료: 내가 남긴 것(주석·밑줄) 우선, 없으면 본문 앞부분.
    let src = "";
    for (const a of p.annotations || []) src += " " + (a.note || "") + " " + (a.on || "");
    for (const h of p.highlights || []) src += " " + h;
    if (!src.trim()) src = paraDomText(p.id).slice(0, 160);
    nodeTokens.push(contentTokens(src));
    nodeTexts.push(src.trim());
    items.push(nodeHTML(p, ni));
  }
  flushSkim();
  _edges = computeEdges(nodeTokens); // 즉시(무료) 어휘 엣지 — 키 있으면 곧 의미로 업그레이드
  _nodeTexts = nodeTexts;
  _semantic = false;

  return `
    <div class="rp-verdict">${esc(verdict)}</div>
    <div class="rp-summary">
      <div class="rp-icap-bar">${icapBar || '<span class="rp-bar-seg rp-icap--p" style="flex:1"></span>'}</div>
      <div class="rp-stats">${chips || '<span class="rp-stat">아직 흔적 없음</span>'}</div>
    </div>
    <ol class="rp-spine">${items.join("")}</ol>
    ${nodeTexts.length >= 2 ? `<div class="rp-edges-legend"></div>` : ""}
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

function nodeHTML(p, ni) {
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
  return `<li class="rp-node ${p.friction_high ? "is-hot" : ""}" data-pid="${p.id}" data-ni="${ni}">
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
