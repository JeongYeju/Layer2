// summary.js — 보드 편집형 "내 말 요약" (내재화 피처 C)
//
// 한 번 읽고 남긴 흔적(주석·하이라이트·티키타카)을 모아, 독자가 *자기 말로*
// 핵심을 정리한 요약 '초안'을 LLM 이 만들어주고 — 독자가 그걸 **직접 고친다**.
// 편집(생성·정교화) 자체가 내재화에 기여한다(자기설명·정교화; docs/theory-base.md §B).
// 기획서 "티키타카 결과가 시맨틱뷰에" 를 충족한다.
//
// 보드 모드 상단에 패널로 뜬다(viewer-shell 이 mount/unmount). 초안은 소스별로
// localStorage 에 저장돼 다음에 보드를 열면 이어서 고칠 수 있다.
//
// 발화 신호: summary_draft { source_id, len, has_llm }

import { buildSessionExport } from "./sidebar.js";
import { refineExport, chatLLM } from "./interpret.js";
import { pushSignal } from "./signals.js";

const KEY_PREFIX = "layer2.summary.";
let panel = null;

export function mountSummary(host) {
  if (!host) return;
  unmountSummary();
  const exp = safeExport();
  const sid = exp?.session?.source_id || "none";

  panel = document.createElement("div");
  panel.className = "board-summary";
  panel.innerHTML = `
    <div class="board-summary-head">
      <span class="board-summary-title">📝 내 말 요약</span>
      <button type="button" class="board-summary-gen">초안 만들기</button>
    </div>
    <textarea class="board-summary-text" placeholder="읽은 걸 내 말로 정리해보세요. '초안 만들기'를 누르면 내가 남긴 주석·밑줄·대화를 모아 시작 초안을 만들어드려요."></textarea>
    <div class="board-summary-status"></div>
  `;
  host.prepend(panel);

  const ta = panel.querySelector(".board-summary-text");
  const status = panel.querySelector(".board-summary-status");

  const saved = loadSummary(sid);
  if (saved) ta.value = saved;

  let t = 0;
  ta.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      saveSummary(sid, ta.value);
      status.textContent = "저장됨";
      setTimeout(() => (status.textContent = ""), 1200);
    }, 500);
  });

  panel
    .querySelector(".board-summary-gen")
    .addEventListener("click", () => generate(ta, status, sid));
}

export function unmountSummary() {
  if (panel) {
    panel.remove();
    panel = null;
  }
}

function safeExport() {
  try {
    return buildSessionExport();
  } catch {
    return null;
  }
}
function loadSummary(sid) {
  try {
    return localStorage.getItem(KEY_PREFIX + sid) || "";
  } catch {
    return "";
  }
}
function saveSummary(sid, v) {
  try {
    localStorage.setItem(KEY_PREFIX + sid, v);
  } catch {
    /* quota */
  }
}
function creds() {
  return {
    provider: localStorage.getItem("layer2.llm.provider") || "anthropic",
    apiKey: (localStorage.getItem("layer2.llm.key") || "").trim(),
  };
}

async function generate(ta, status, sid) {
  const exp = safeExport();
  if (!exp || !exp.source) {
    status.textContent = "아직 읽기 세션이 없어요.";
    return;
  }
  let digest = null;
  try {
    digest = refineExport(exp);
  } catch {
    /* optional */
  }
  const m = collectMaterial(digest);
  if (!m.annotations.length && !m.highlights.length) {
    status.textContent = "주석이나 밑줄을 남긴 뒤 다시 시도하세요.";
    return;
  }
  const draft = await draftSummary(exp, m, status);
  if (draft) {
    ta.value = draft;
    saveSummary(sid, draft);
    pushSignal({
      type: "summary_draft",
      source_id: sid,
      len: draft.length,
      has_llm: !!creds().apiKey,
    });
  }
}

function collectMaterial(digest) {
  const annotations = [];
  const highlights = [];
  const chatParas = [];
  for (const p of digest?.paragraphs || []) {
    for (const a of p.annotations || []) if (a && a.note) annotations.push(a.note);
    for (const h of p.highlights || []) if (h) highlights.push(h);
    if ((p.chat_turns || 0) > 0 && p.text_preview) chatParas.push(p.text_preview);
  }
  return { annotations, highlights, chatParas };
}

async function draftSummary(exp, m, status) {
  const fallback = buildFallback(m);
  const { provider, apiKey } = creds();
  if (!apiKey) return fallback; // 키 없으면 흔적 기반 초안(데모 안 깨짐)

  status.textContent = "초안 생성 중…";
  try {
    const body = (exp.source.blocks || [])
      .filter((b) => b.text)
      .map((b) => b.text)
      .join("\n")
      .slice(0, 2500);
    const system =
      "독자가 글을 읽으며 남긴 주석·밑줄·대화를 바탕으로, 그 독자가 *자기 말로* 글의 핵심을 정리한 요약 '초안'을 써주는 도우미입니다. " +
      "1인칭('나는…')으로 3~4문장, 독자가 바로 이어서 고칠 수 있게 담백하게. " +
      "독자가 실제로 주목한 것에 충실하고, 없는 내용을 지어내지 마세요. 한국어로.";
    const user =
      `## 글(발췌)\n${body}\n\n` +
      `## 내가 남긴 주석\n${m.annotations.map((a) => "- " + a).join("\n") || "(없음)"}\n\n` +
      `## 내가 밑줄 친 것\n${m.highlights.map((h) => "- " + h).join("\n") || "(없음)"}\n\n` +
      `위를 바탕으로 '내 말 요약' 초안을 써줘.`;
    const reply = await chatLLM({
      provider,
      apiKey,
      system,
      messages: [{ role: "user", content: user }],
    });
    status.textContent = "";
    return (reply || "").trim() || fallback;
  } catch {
    status.textContent = "생성 실패 — 흔적 기반 초안으로 대체했어요.";
    return fallback;
  }
}

function buildFallback(m) {
  const lines = ["내가 이 글에서 주목한 것:"];
  for (const h of m.highlights.slice(0, 5)) lines.push(`- “${h}”`);
  if (m.annotations.length) {
    lines.push("", "내가 남긴 생각:");
    for (const a of m.annotations.slice(0, 5)) lines.push(`- ${a}`);
  }
  lines.push("", "(여기에 내 말로 핵심을 이어서 정리해보세요.)");
  return lines.join("\n");
}
