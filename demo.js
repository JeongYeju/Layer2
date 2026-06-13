// demo.js — 더미 독서 신호 생성기 (데모/검증용)
//
// 실제 독서를 흉내 내 단락마다 다른 패턴의 신호를 남긴다. 그러면 마찰 계수·
// ICAP·촛불·티키타카·보드 시맨틱 색이 한 번에 채워져, 엔드투엔드 흐름을
// 정성적으로 체감할 수 있다. 코드 한 줄 없이 DevTools 에서:
//   window.__layer2Demo.seed()   // 즉시 시드 (보드/대시보드 채우기)
//   window.__layer2Demo.play()   // 시간순 재생 (스크롤 + 신호 → 촛불·티키타카 자연 발동)
//   window.__layer2Demo.clear()  // 비우고 새로고침

import { pushSignal, SignalLog } from "./signals.js";
import { pushSummary } from "./sessions.js";

let readerEl = null;

export function initDemo(opts) {
  readerEl = opts.readerEl;
  window.__layer2Demo = { seed, seedRich, play, runDemo, clear, roleFor, seedSessions };
  wireDemoButtons();
}

// Presenter button (#demo-run): replay a reading session over the loaded
// article so the annotation/isolation signals reach candle.js and a candle
// lights up — no DevTools needed. Re-entrancy guarded; #demo-reset reloads.
let _demoRunning = false;
async function runDemo() {
  if (_demoRunning) return 0;
  if (!paras().length) {
    console.warn("[demo] 로드된 글이 없습니다 — 먼저 글을 여세요.");
    return 0;
  }
  _demoRunning = true;
  const btn = document.getElementById("demo-run");
  const orig = btn ? btn.innerHTML : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "재생 중…";
  }
  try {
    await play();
  } finally {
    _demoRunning = false;
    if (btn) {
      btn.disabled = false;
      if (orig != null) btn.innerHTML = orig;
    }
  }
  return 1;
}

function wireDemoButtons() {
  document.getElementById("demo-run")?.addEventListener("click", runDemo);
  document.getElementById("demo-reset")?.addEventListener("click", clear);
}

// Seed several past sessions across different times of day / topics so the
// multi-session macro report (dashboard) has something to show without
// actually reading N documents. Best-effort timestamps relative to now.
function seedSessions(count = 8) {
  let now;
  try {
    now = Date.now();
  } catch {
    now = 0;
  }
  const DAY = 86400000;
  const topics = [
    "표면장력과 계면 현상",
    "에리히 프롬, 사랑의 기술",
    "그리스 신화 원전 읽기",
    "SwiftUI 상태 관리",
    "디지털 시대의 읽기",
    "인지부하 이론 개관",
  ];
  // hours skew toward evening/late-night deep reading
  const hours = [9, 14, 16, 22, 23, 1, 20, 15, 11, 2];
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = now - (count - i) * (DAY / 2) - Math.floor((i % 3) * 1.5e6);
    const hour = hours[i % hours.length];
    // later/evening sessions trend to higher friction (heavier reading)
    const base = hour >= 20 || hour <= 2 ? 1.4 : 0.6;
    const mean = +(base + (i % 4) * 0.25 - 0.3).toFixed(2);
    const high = Math.max(0, Math.round(mean * 2));
    const P = 3 + (i % 3), A = 1 + (i % 2), C = (i % 2), I = hour >= 20 ? 1 : 0;
    out.push({
      id: `demo_${t}_${i}`,
      t,
      hour,
      source_id: `demo${i}`,
      source_title: topics[i % topics.length],
      duration_ms: (12 + (i % 5) * 6) * 60000,
      paragraphs: 6 + (i % 4),
      friction: { mean, max: +(mean + 0.8).toFixed(2), high },
      icap: { P, A, C, I },
    });
  }
  out.forEach(pushSummary);
  console.log(`[demo] seeded ${out.length} past sessions`);
  return out.length;
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
      annotation_text: "이게 핵심 개념이구나 : 앞 단락의 주장과 이렇게 연결되는 듯.",
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

// 발표/스크린샷용 풍성한 시드 — 많은 단락에 흔적을 남겨 멘탈맵을 별자리처럼.
// 각 노드의 임베딩 입력(밑줄=단락 텍스트 조각, 일부 주석)이 단락마다 달라
// 의미 엣지가 여러 개 뜬다. window.__layer2Demo.seedRich().
function seedRich() {
  const ps = paras();
  const notes = [
    null,
    "이게 핵심 개념이구나 : 앞 단락의 주장과 이렇게 연결되는 듯.",
    null,
    "여기는 잘 안 잡혀서 다시 읽었다.",
    "이 문장이 제일 중요해 보인다.",
    null,
    "내 말로 다시 정리해두고 싶은 부분.",
    null,
    "앞에서 말한 개념이 여기서 또 나온다.",
    "결론이 여기서 한 번에 모이는 느낌.",
  ];
  ps.forEach((p, i) => {
    const pid = p.dataset.paragraphId;
    const t = (p.textContent || "").replace(/💬?\s*대화\s*$/, "").trim();
    if (t.length < 6) return;
    const slice = (a, b) => t.slice(a, b) || t.slice(0, 16);
    const now = performance.now();
    pushSignal({ type: "dwell", paragraph_id: pid, duration_ms: 4000 + i * 300, visible_frac: 0.86, enter_count: 1, total_ms: 4000 + i * 300 });
    // 대부분 단락에 밑줄 → 노드 + 임베딩 가능한 텍스트(단락마다 내용이 달라 별자리)
    pushSignal({ type: "highlight_underline", paragraph_id: pid, selected_text: slice(0, Math.min(46, t.length)), char_range: [0, Math.min(46, t.length)], duration_ms: 1400, draw_speed: 11 });
    if (notes[i]) {
      pushSignal({
        type: "highlight_annotation", paragraph_id: pid,
        anchor_text: slice(0, 18), annotation_text: notes[i],
        underline_start_t: now, transition_t: now + 1800,
        textarea_appeared_t: now + 5400, confirm_t: now + 12000, total_duration_ms: 12000,
      });
    }
  });
  if (ps[3]) pushSignal({ type: "circle_gesture", enclosed_paragraph: ps[3].dataset.paragraphId, enclosed_text: "표시", radius: 40 });
  if (ps[6]) pushSignal({ type: "reread", paragraph_id: ps[6].dataset.paragraphId, visit_count: 3, enter_count: 3, reverse_rate: 0.62, scroll_top: 1200 });
  if (ps[1]) {
    const pid = ps[1].dataset.paragraphId;
    pushSignal({ type: "chat_opened", paragraph_id: pid, reason: "annotation" });
    pushSignal({ type: "chat_turn", role: "user", len: 38, paragraph_id: pid, reason: "annotation" });
    pushSignal({ type: "chat_turn", role: "assistant", len: 96, paragraph_id: pid, reason: "annotation" });
  }
  console.log(`[demo] seedRich: ${ps.length} paragraphs marked`);
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
