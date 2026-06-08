// chat.js — AI 티키타카 (Phase 2.5.4)
//
// 내러티브 아교의 마지막 조각: 촛불이 "질문 던지고 끝"이 아니라, 클릭하면
// 옆에서 *왕복 대화*가 시작된다. 촛불이 뜬 단락과 그 Seam(annotation/isolation/
// transition)을 컨텍스트(Anchor)로 받아, 직접 답을 주기보다 질문으로 독자가
// 스스로 답을 떠올리게 돕는(자기설명 유도) 대화. ("소크라테스식"이라는 표현은
// 특정 논문 근거가 아닌 일반 용어였음 — docs/theory-base.md 참조.)
// LLM 호출은 interpret.js 의 chatLLM 재사용, API 키는 대시보드와 같은
// localStorage(layer2.llm.*)를 공유.
//
// 트리거: candle.js 가 촛불 풍선의 "대화" 버튼에서 `candle_chat_request` 발화
//   { paragraph_id, reason, line, para_text } → 이 모듈이 구독.

import { signalBus, pushSignal } from "./signals.js";
import { chatLLM, refineExport } from "./interpret.js";
import { buildSessionExport } from "./sidebar.js";

// small lit candle for the panel header
const CANDLE_ICO = `
  <svg class="chat-candle-ico" viewBox="0 0 28 56" aria-hidden="true">
    <rect x="11" y="22" width="6" height="30" rx="1.5" fill="#e8dec3" stroke="#b09d75" stroke-width="0.6"/>
    <line x1="14" y1="22" x2="14" y2="18" stroke="#4a3a22" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M14 6 C 18 12, 19 16, 14 20 C 9 16, 10 12, 14 6 Z" fill="#f0a830" opacity="0.92">
      <animate attributeName="opacity" values="0.92;0.7;0.92" dur="1.8s" repeatCount="indefinite"/>
    </path>
    <path d="M14 10 C 16 14, 16.5 16, 14 19 C 11.5 16, 12 14, 14 10 Z" fill="#fff2b8"/>
  </svg>`;

const SYSTEM =
  "당신은 '촛불' — 독서 중 곁에서 돕는 따뜻한 AI 동반자입니다. " +
  "짧고 담백하게(2~4문장), 직접 답을 주기보다 질문으로 독자가 스스로 답을 떠올리도록 돕습니다. " +
  "장황한 설명이나 과장은 피하고, 한국어로 대화하세요.";

const REASON_TONE = {
  annotation:
    "독자가 방금 이 단락에 주석을 남겼습니다. 그 생각을 출발점으로 사유를 한 걸음 넓히는 질문을 던지세요.",
  isolation:
    "독자가 이 단락에서 여러 번 되돌아오며 막혀 헤매고 있습니다. 핵심 구조나 주장을 짚어 이해를 도우세요.",
  transition:
    "독자가 잠시 쉬었다 돌아왔습니다. 흐름을 환기하고 어디까지 읽었는지 가볍게 짚어주세요.",
  stuck:
    "독자가 이 단락에 오래 머물고 있습니다. 어려운 개념을 차근차근 풀어주세요.",
  manual: "독자가 먼저 말을 걸었습니다. 자연스럽게 응답하세요.",
  review:
    "독자가 글을 끝까지 읽고 마무리하는 시점입니다. 방금 읽은 내용을 스스로 정리·재구성하게 돕는 '이해 점검' 대화를 하세요. " +
    "핵심을 독자 본인의 말로 요약하게 하고, 아래 [독자가 특히 붙잡았던 대목]을 짚어 '이제 설명할 수 있는지' 부드럽게 물어보세요. " +
    "정답을 먼저 말하지 말고 질문으로 끌어내세요. 한 번에 한 가지만.",
};

let panel, logEl, inputEl, sendBtn, titleEl;
let conversation = []; // [{ role:"user"|"assistant", content }]
let ctx = null; // { paragraph_id, reason, para_text }

export function initChat() {
  buildPanel();
  signalBus.addEventListener("signal", (e) => {
    const t = e.detail?.type;
    if (t === "candle_chat_request") openFor(e.detail);
    // 독서 후 티키타카 — '독서 종료' 시 이해 점검 대화 런처를 띄운다 (내재화 · for 메타인지 마무리).
    else if (t === "session_end") showReviewLauncher();
    else if (t === "session_start") hideReviewLauncher();
  });
  // DevTools/데모 훅: 언제든 복습 대화 열기.
  window.__layer2Chat = { review: openReview };
}

function buildPanel() {
  if (panel) return;
  panel = document.createElement("aside");
  panel.id = "chat-panel";
  panel.className = "chat-panel";
  panel.innerHTML = `
    <header class="chat-head">
      <span class="chat-title-wrap">${CANDLE_ICO}<span class="chat-title" id="chat-title">촛불과의 대화</span></span>
      <button type="button" class="chat-close" id="chat-close" aria-label="닫기">✕</button>
    </header>
    <div class="chat-log" id="chat-log"></div>
    <form class="chat-input-row" id="chat-form">
      <input type="text" class="chat-input" id="chat-input"
        placeholder="촛불에게 말 걸기…" autocomplete="off" />
      <button type="submit" class="chat-send" id="chat-send">보내기</button>
    </form>
  `;
  document.body.appendChild(panel);
  logEl = panel.querySelector("#chat-log");
  inputEl = panel.querySelector("#chat-input");
  sendBtn = panel.querySelector("#chat-send");
  titleEl = panel.querySelector("#chat-title");

  panel.querySelector("#chat-close").addEventListener("click", close);
  panel.querySelector("#chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });
}

const REASON_LABEL = {
  annotation: "주석 직후",
  isolation: "막힌 지점",
  transition: "다시 돌아온 자리",
  stuck: "오래 머문 단락",
  manual: "대화",
  review: "읽고 난 뒤",
};

const REVIEW_OPENERS = [
  "다 읽었네 :) 방금 읽은 거, 핵심만 네 말로 정리해볼래?",
  "수고했어. 가장 기억에 남는 한 가지가 뭐였어?",
  "끝까지 왔구나. 누군가에게 한 문장으로 설명한다면 어떻게 말할래?",
  "다 봤네. 읽기 전과 후, 생각이 바뀐 게 있어?",
];

function openFor(req) {
  ctx = req;
  conversation = [];
  logEl.innerHTML = "";
  titleEl.textContent = `촛불 · ${REASON_LABEL[req.reason] || "대화"}`;
  panel.classList.add("is-open");
  // 상호작용 축 데이터 — 어느 단락/Seam 에서 티키타카가 열렸나.
  pushSignal({
    type: "chat_opened",
    paragraph_id: req.paragraph_id,
    reason: req.reason,
  });
  // 촛불이 먼저 건넨 한 마디로 대화를 연다 (화면에만, 대화 히스토리엔 미포함 —
  // 첫 LLM 메시지는 user 여야 하므로). 키가 있으면 단락에 맞춘 첫 질문으로 교체.
  const opener = addBubble("assistant", req.line || "이 부분, 같이 볼까?");
  maybeUpgradeOpener(opener, req);
  inputEl.focus();
}

// API 키가 있으면 정적 멘트를 단락·Seam 에 맞춘 LLM 첫 질문으로 슬쩍 교체한다.
// 키가 없거나 실패하면 정적 멘트 그대로 (데모에서도 항상 무언가 떠 있게).
async function maybeUpgradeOpener(bubble, req) {
  const { provider, apiKey } = creds();
  if (!apiKey || !req.para_text) return;
  try {
    const system =
      SYSTEM +
      "\n\n[상황] " +
      (REASON_TONE[req.reason] || REASON_TONE.manual) +
      "\n[독자가 보던 단락]\n" +
      req.para_text +
      "\n\n위 단락과 상황에 딱 맞는, 독자에게 건넬 짧은 첫 마디(질문형 1문장)만 출력하세요.";
    const reply = await chatLLM({
      provider,
      apiKey,
      system,
      messages: [{ role: "user", content: "첫 마디만 건네줘." }],
    });
    const clean = (reply || "").trim();
    if (clean && bubble.isConnected) bubble.textContent = clean;
  } catch {
    /* keep the static opener */
  }
}

// ---------- 독서 후 티키타카 (review) ----------

// Build a whole-reading digest as the chat anchor: title + the reader's own
// notes + the paragraphs they wrestled with most (friction_high). Reuses the
// session export + refine pipeline so no new signal collection is needed.
function buildReviewContext() {
  let exp = null;
  let digest = null;
  try {
    exp = buildSessionExport();
  } catch {
    /* no completed session */
  }
  if (exp?.source) {
    try {
      digest = refineExport(exp);
    } catch {
      /* digest optional */
    }
  }
  const title = exp?.source?.title || exp?.session?.source_title || "방금 읽은 글";
  const lines = [`[제목] ${title}`];
  const notes = (digest?.annotations || []).filter((a) => a.annotation_text);
  if (notes.length) {
    lines.push("[독자가 남긴 메모]");
    for (const a of notes.slice(0, 6)) {
      lines.push(`- "${a.anchor_text}" → ${a.annotation_text}`);
    }
  }
  const hot = (digest?.paragraphs || []).filter((p) => p.friction_high);
  if (hot.length) {
    lines.push("[독자가 특히 붙잡았던 대목]");
    for (const p of hot.slice(0, 4)) lines.push(`- ${p.text_preview}`);
  }
  return { text: lines.join("\n"), hasData: !!digest };
}

export function openReview() {
  const c = buildReviewContext();
  ctx = { paragraph_id: null, reason: "review", para_text: c.text };
  conversation = [];
  logEl.innerHTML = "";
  titleEl.textContent = `촛불 · ${REASON_LABEL.review}`;
  panel.classList.add("is-open");
  pushSignal({ type: "chat_opened", reason: "review" });
  const line = REVIEW_OPENERS[Math.floor(Math.random() * REVIEW_OPENERS.length)];
  const opener = addBubble("assistant", line);
  // 키가 있으면 방금 읽은 글에 맞춘 첫 질문으로 교체.
  maybeUpgradeOpener(opener, { reason: "review", para_text: c.text });
  inputEl.focus();
}

// Small launcher that appears after '독서 종료' so finishing a reading offers a
// closing comprehension chat without auto-hijacking the screen.
let launcher = null;
function showReviewLauncher() {
  if (launcher) return;
  launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "review-launcher";
  launcher.textContent = "📖 읽고 난 뒤 — 이해 점검 대화";
  launcher.addEventListener("click", () => {
    hideReviewLauncher();
    openReview();
  });
  document.body.appendChild(launcher);
  requestAnimationFrame(() => launcher.classList.add("is-shown"));
  launcher.__t = setTimeout(hideReviewLauncher, 30000);
}
function hideReviewLauncher() {
  if (!launcher) return;
  clearTimeout(launcher.__t);
  launcher.remove();
  launcher = null;
}

function close() {
  panel.classList.remove("is-open");
  ctx = null;
}

function creds() {
  return {
    provider: localStorage.getItem("layer2.llm.provider") || "anthropic",
    apiKey: (localStorage.getItem("layer2.llm.key") || "").trim(),
  };
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || !ctx) return;
  inputEl.value = "";
  addBubble("user", text);
  conversation.push({ role: "user", content: text });
  pushSignal({
    type: "chat_turn",
    role: "user",
    len: text.length,
    paragraph_id: ctx.paragraph_id,
    reason: ctx.reason,
  });

  const { provider, apiKey } = creds();
  if (!apiKey) {
    addBubble(
      "assistant",
      "API 키가 없어 대화를 못 해요. 우측 대시보드의 'AI 해석'에서 키를 넣어주세요.",
    );
    return;
  }

  const typing = addTyping();
  sendBtn.disabled = true;
  try {
    const system =
      SYSTEM +
      "\n\n[상황] " +
      (REASON_TONE[ctx.reason] || REASON_TONE.manual) +
      (ctx.para_text ? "\n[독자가 보던 단락]\n" + ctx.para_text : "");
    const reply = await chatLLM({ provider, apiKey, system, messages: conversation });
    const clean = (reply || "").trim() || "(응답이 비었어요)";
    typing.classList.remove("chat-typing");
    typing.textContent = clean;
    conversation.push({ role: "assistant", content: clean });
    pushSignal({
      type: "chat_turn",
      role: "assistant",
      len: clean.length,
      paragraph_id: ctx?.paragraph_id,
      reason: ctx?.reason,
    });
  } catch (err) {
    typing.classList.remove("chat-typing"); // else the error text renders as bouncing dots
    typing.textContent = "대화 실패: " + (err?.message || err);
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

function addBubble(role, text) {
  const b = document.createElement("div");
  b.className = `chat-msg chat-msg--${role}`;
  b.textContent = text;
  logEl.appendChild(b);
  logEl.scrollTop = logEl.scrollHeight;
  return b;
}

// Bouncing-dots typing indicator (replaced with the reply text on arrival).
function addTyping() {
  const b = document.createElement("div");
  b.className = "chat-msg chat-msg--assistant chat-typing";
  b.innerHTML = `<span></span><span></span><span></span>`;
  logEl.appendChild(b);
  logEl.scrollTop = logEl.scrollHeight;
  return b;
}
