// recall.js — 능동 인출 회상 워크시트 (내재화 피처 B)
//
// 내가 친 밑줄(highlight)을 cloze 빈칸으로 바꿔 *다시 떠올리게* 한다. 읽기의
// 흔적(밑줄)은 그 자체론 저(低)유틸리티(Dunlosky 2013: highlighting=low)지만,
// 그걸 능동 인출(practice testing=high) + 생성(generation effect)으로 변환하면
// 내재화에 기여한다 — 이것이 본 피처의 이론적 근거다.
//
// 카드 형식: 기본 = 밑줄 부분만 빈칸(cued recall, 문맥=부호화 단서 유지) /
//            "더 어렵게" = 문맥을 가린 자유 회상(free recall, 바람직한 어려움).
//   근거: Slamecka & Graf 1978(생성효과), Dunlosky 2013(연습시험 高유틸),
//        cued>free(단서가 부호화와 일치할 때). 상세 docs/theory-base.md §B.
//
// 발화 신호: recall_worksheet { card_count, mode } · recall_attempt
//            { paragraph_id, mode, self_correct, answer_len }

import { buildSessionExport } from "./sidebar.js";
import { refineExport } from "./interpret.js";
import { pushSignal } from "./signals.js";

let mountEl = null;
let hardMode = false;

export function initRecall(opts) {
  mountEl = opts?.mountEl || null;
  if (!mountEl) return;
  mountEl.innerHTML = `
    <div class="recall-controls">
      <button type="button" id="recall-gen" class="interp-load-btn">워크시트 생성</button>
      <label class="recall-hard" title="문맥을 가린 자유 회상(더 어려움)">
        <input type="checkbox" id="recall-hard" /> 더 어렵게
      </label>
    </div>
    <div id="recall-body">
      <div class="interp-empty">독서 후 '워크시트 생성'을 누르면, 밑줄 친 부분을 빈칸으로 다시 떠올리는 카드를 만들어요.</div>
    </div>
  `;
  mountEl.querySelector("#recall-gen").addEventListener("click", generate);
  mountEl
    .querySelector("#recall-hard")
    .addEventListener("change", (e) => (hardMode = e.target.checked));
}

function generate() {
  const body = mountEl.querySelector("#recall-body");
  let exp = null;
  try {
    exp = buildSessionExport();
  } catch {
    /* none */
  }
  if (!exp || !exp.source) {
    body.innerHTML = `<div class="interp-note">아직 독서 세션이 없어요. 글을 조금 읽고 밑줄을 친 뒤 다시 시도하세요.</div>`;
    return;
  }
  const cards = buildCards(exp);
  if (!cards.length) {
    body.innerHTML = `<div class="interp-note">회상 카드로 만들 밑줄이 없어요. 핵심 구절에 밑줄을 그어보세요.</div>`;
    return;
  }
  pushSignal({
    type: "recall_worksheet",
    card_count: cards.length,
    mode: hardMode ? "free" : "cued",
  });
  body.innerHTML = "";
  cards.forEach((c) => body.appendChild(renderCard(c)));
}

// 밑줄 → 카드. selected_text 를 needle 로 써서 grapheme-index 계산을 피한다.
function buildCards(exp) {
  const blocks = exp.source.blocks || [];
  const pidText = {};
  blocks.forEach((b, i) => {
    if (["heading", "paragraph", "blockquote", "code"].includes(b.type)) {
      pidText[`p${i}`] = b.text || "";
    } else if (b.type === "list") {
      (b.items || []).forEach((it, j) => (pidText[`p${i}_li${j}`] = it));
    }
  });

  let digest = null;
  try {
    digest = refineExport(exp);
  } catch {
    /* highlights optional */
  }

  const out = [];
  const seen = new Set();
  for (const h of digest?.highlights || []) {
    const answer = (h.text || "").trim();
    if (answer.length < 2) continue; // 한 글자짜리는 인출 가치 낮음
    const para = pidText[h.paragraph_id] || "";
    if (!para.includes(answer)) continue;
    const key = `${h.paragraph_id}|${answer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      pid: h.paragraph_id,
      answer,
      sentence: sentenceContaining(para, answer) || para,
    });
    if (out.length >= 8) break; // 워크시트 한 판은 8장까지
  }
  return out;
}

// Exported so other views (e.g. board mode's inline recall) can reuse the same
// sentence-extraction without re-deriving grapheme indices.
export function sentenceContaining(text, needle) {
  const parts = String(text || "").split(/(?<=[.!?。])\s+/);
  for (const s of parts) if (s.includes(needle)) return s.trim();
  return null;
}

function renderCard(card) {
  const el = document.createElement("div");
  el.className = "recall-card";

  const prompt = hardMode
    ? `<div class="recall-prompt recall-free">${escapeHtml(card.pid)} 단락에서 당신이 표시했던 핵심을 — 문맥 없이 — 떠올려 적어보세요.</div>`
    : `<div class="recall-prompt">${escapeHtml(card.sentence).replace(
        escapeHtml(card.answer),
        `<span class="recall-blank">____</span>`,
      )}</div>`;

  el.innerHTML = `
    ${prompt}
    <div class="recall-row">
      <input type="text" class="recall-input" placeholder="떠오른 답을 적어보세요…" />
      <button type="button" class="recall-check">확인</button>
    </div>
    <div class="recall-reveal" hidden></div>
  `;

  const input = el.querySelector(".recall-input");
  const checkBtn = el.querySelector(".recall-check");
  const reveal = el.querySelector(".recall-reveal");

  const doCheck = () => {
    if (!reveal.hidden) return;
    const attemptLen = input.value.trim().length;
    reveal.hidden = false;
    reveal.innerHTML = `
      <div class="recall-answer">정답: <b>${escapeHtml(card.answer)}</b></div>
      <div class="recall-rate">기억났나요?
        <button type="button" class="recall-yes" data-r="1">✅ 떠올랐다</button>
        <button type="button" class="recall-no" data-r="0">❌ 아니다</button>
      </div>`;
    input.disabled = true;
    checkBtn.disabled = true;
    reveal.querySelectorAll("button[data-r]").forEach((b) =>
      b.addEventListener("click", () => {
        const correct = b.dataset.r === "1";
        pushSignal({
          type: "recall_attempt",
          paragraph_id: card.pid,
          mode: hardMode ? "free" : "cued",
          self_correct: correct,
          answer_len: attemptLen,
        });
        reveal.querySelector(".recall-rate").innerHTML = correct
          ? `<span class="recall-good">좋아요 — 인출 성공 ✨</span>`
          : `<span class="recall-again">괜찮아요. 다시 보면 더 또렷해져요.</span>`;
      }),
    );
  };

  checkBtn.addEventListener("click", doCheck);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doCheck();
    }
  });
  return el;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}
