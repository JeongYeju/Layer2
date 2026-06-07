// demo.js — 더미 독서 신호 생성기 (데모/검증용)
//
// 실제 독서를 흉내 내 단락마다 다른 패턴의 신호를 남긴다. 그러면 마찰 계수·
// ICAP·촛불·티키타카·보드 시맨틱 색이 한 번에 채워져, 엔드투엔드 흐름을
// 정성적으로 체감할 수 있다. 코드 한 줄 없이 DevTools 에서:
//   window.__layer2Demo.seed()   // 즉시 시드 (보드/대시보드 채우기)
//   window.__layer2Demo.play()   // 시간순 재생 (스크롤 + 신호 → 촛불·티키타카 자연 발동)
//   window.__layer2Demo.clear()  // 비우고 새로고침

import { pushSignal, SignalLog } from "./signals.js";

let readerEl = null;

export function initDemo(opts) {
  readerEl = opts.readerEl;
  window.__layer2Demo = { seed, play, clear, roleFor };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const paras = () => [...(readerEl?.querySelectorAll(".para[data-paragraph-id]") || [])];

// 단락 인덱스 → 독서 역할. 다양한 인지 상태가 골고루 나오도록 배치.
function roleFor(i, n) {
  const f = i / Math.max(1, n - 1);
  if (i === 1) return "deep";       // 깊게 읽음 + 정교한 주석 + AI 대화 → Constructive→Interactive
  if (i === 2) return "stuck";      // 막힘: 반복 재진입·역방향·무흔적 → isolation, extraneous
  if (i === 4) return "highlight";  // 핵심 표시 → Active
  if (i === 5) return "circle";     // 동그라미 → Active
  if (f < 0.12 || f > 0.86) return "scan"; // 처음/끝 훑기 → Passive, low friction
  return "normal";                  // 유창한 읽기
}

function emitFor(pid, text, role, baseTop) {
  const t = (text || "").replace(/💬?\s*대화\s*$/, "").trim();
  const slice = (a, b) => t.slice(a, b) || t.slice(0, 12);
  const now = performance.now();

  if (role === "scan") {
    pushSignal({ type: "dwell", paragraph_id: pid, duration_ms: 1600, visible_frac: 0.7, enter_count: 1, total_ms: 1600 });
    return;
  }
  if (role === "normal") {
    pushSignal({ type: "dwell", paragraph_id: pid, duration_ms: 5200, visible_frac: 0.86, enter_count: 1, total_ms: 5200 });
    return;
  }
  if (role === "highlight") {
    pushSignal({ type: "dwell", paragraph_id: pid, duration_ms: 6400, visible_frac: 0.9, enter_count: 1, total_ms: 6400 });
    pushSignal({ type: "highlight_underline", paragraph_id: pid, selected_text: slice(0, 18), char_range: [0, 18], duration_ms: 1400, draw_speed: 12 });
    return;
  }
  if (role === "circle") {
    pushSignal({ type: "dwell", paragraph_id: pid, duration_ms: 4200, visible_frac: 0.8, enter_count: 1, total_ms: 4200 });
    pushSignal({ type: "circle_gesture", enclosed_paragraph: pid, enclosed_text: slice(0, 8), radius: 40 });
    return;
  }
  if (role === "stuck") {
    // 긴 체류 + 여러 번 위로 되돌아 진입 + 아무 흔적 없음 → isolation_seam 조건.
    pushSignal({ type: "dwell", paragraph_id: pid, duration_ms: 9800, visible_frac: 0.85, enter_count: 3, total_ms: 9800 });
    pushSignal({ type: "reread", paragraph_id: pid, visit_count: 2, enter_count: 2, reverse_rate: 0.5, scroll_top: baseTop });
    pushSignal({ type: "reread", paragraph_id: pid, visit_count: 3, enter_count: 3, reverse_rate: 0.67, scroll_top: baseTop + 220 });
    return;
  }
  if (role === "deep") {
    // 긴 체류 + 정교한 선택 하이라이트 + 사려깊은 주석 + AI 대화.
    pushSignal({ type: "dwell", paragraph_id: pid, duration_ms: 13500, visible_frac: 0.92, enter_count: 1, total_ms: 13500 });
    pushSignal({ type: "highlight_underline", paragraph_id: pid, selected_text: slice(4, 22), char_range: [4, 22], duration_ms: 1800, draw_speed: 9 });
    pushSignal({
      type: "highlight_annotation", paragraph_id: pid,
      anchor_text: slice(4, 22),
      annotation_text: "이게 핵심 개념이구나 — 앞 단락의 주장과 이렇게 연결되는 듯.",
      underline_start_t: now, transition_t: now + 1800,
      textarea_appeared_t: now + 5400, confirm_t: now + 12000, total_duration_ms: 12000,
    });
    pushSignal({ type: "chat_opened", paragraph_id: pid, reason: "annotation" });
    pushSignal({ type: "chat_turn", role: "user", len: 38, paragraph_id: pid, reason: "annotation" });
    pushSignal({ type: "chat_turn", role: "assistant", len: 96, paragraph_id: pid, reason: "annotation" });
    return;
  }
}

// 즉시 시드 — 신호를 한꺼번에 쌓는다. 보드/대시보드를 채워 결과 상태를 본다.
function seed() {
  const ps = paras();
  ps.forEach((p, i) =>
    emitFor(p.dataset.paragraphId, p.textContent, roleFor(i, ps.length), i * 300),
  );
  console.log(`[demo] seeded reading signals for ${ps.length} paragraphs`);
  return ps.length;
}

// 시간순 재생 — 단락을 따라 내려가며 신호를 흘린다. reread/annotation 신호가
// 실시간으로 candle.js 에 닿아 촛불·티키타카가 자연스럽게 발동한다 (정성 체감).
async function play() {
  const ps = paras();
  console.log(`[demo] playing reading session over ${ps.length} paragraphs…`);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    p.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(700);
    emitFor(p.dataset.paragraphId, p.textContent, roleFor(i, ps.length), i * 300);
    await sleep(role(i, ps.length) === "deep" || role(i, ps.length) === "stuck" ? 1800 : 700);
  }
  console.log("[demo] done.");
}
const role = roleFor;

function clear() {
  SignalLog.length = 0;
  // eslint-disable-next-line no-undef
  location.reload();
}
