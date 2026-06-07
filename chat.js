// chat.js — AI 티키타카 (Phase 2.5.4)
//
// 내러티브 아교의 마지막 조각: 촛불이 "질문 던지고 끝"이 아니라, 클릭하면
// 옆에서 *왕복 대화*가 시작된다. 촛불이 뜬 단락과 그 Seam(annotation/isolation/
// transition)을 컨텍스트(Anchor)로 받아, 독자 스스로 생각하게 돕는 소크라테스식
// 대화. LLM 호출은 interpret.js 의 chatLLM 재사용, API 키는 대시보드와 같은
// localStorage(layer2.llm.*)를 공유.
//
// 트리거: candle.js 가 촛불 풍선의 "대화" 버튼에서 `candle_chat_request` 발화
//   { paragraph_id, reason, line, para_text } → 이 모듈이 구독.

import { signalBus } from "./signals.js";
import { chatLLM } from "./interpret.js";

const SYSTEM =
  "당신은 '촛불' — 독서 중 곁에서 돕는 따뜻한 AI 동반자입니다. " +
  "짧고 담백하게(2~4문장), 소크라테스식으로 독자가 스스로 생각하도록 돕습니다. " +
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
};

let panel, logEl, inputEl, sendBtn, titleEl;
let conversation = []; // [{ role:"user"|"assistant", content }]
let ctx = null; // { paragraph_id, reason, para_text }

export function initChat() {
  buildPanel();
  signalBus.addEventListener("signal", (e) => {
    if (e.detail?.type === "candle_chat_request") openFor(e.detail);
  });
}

function buildPanel() {
  if (panel) return;
  panel = document.createElement("aside");
  panel.id = "chat-panel";
  panel.className = "chat-panel";
  panel.innerHTML = `
    <header class="chat-head">
      <span class="chat-title" id="chat-title">촛불과의 대화</span>
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
};

function openFor(req) {
  ctx = req;
  conversation = [];
  logEl.innerHTML = "";
  titleEl.textContent = `촛불 · ${REASON_LABEL[req.reason] || "대화"}`;
  panel.classList.add("is-open");
  // 촛불이 먼저 건넨 한 마디로 대화를 연다 (화면에만, 대화 히스토리엔 미포함 —
  // 첫 LLM 메시지는 user 여야 하므로).
  addBubble("assistant", req.line || "이 부분, 같이 볼까?");
  inputEl.focus();
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

  const { provider, apiKey } = creds();
  if (!apiKey) {
    addBubble(
      "assistant",
      "API 키가 없어 대화를 못 해요. 우측 대시보드의 'AI 해석'에서 키를 넣어주세요.",
    );
    return;
  }

  const typing = addBubble("assistant", "…");
  sendBtn.disabled = true;
  try {
    const system =
      SYSTEM +
      "\n\n[상황] " +
      (REASON_TONE[ctx.reason] || REASON_TONE.manual) +
      (ctx.para_text ? "\n[독자가 보던 단락]\n" + ctx.para_text : "");
    const reply = await chatLLM({ provider, apiKey, system, messages: conversation });
    const clean = (reply || "").trim() || "(응답이 비었어요)";
    typing.textContent = clean;
    conversation.push({ role: "assistant", content: clean });
  } catch (err) {
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
