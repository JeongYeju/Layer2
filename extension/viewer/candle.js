// candle.js — Stick Candle (초안 v0.1)
//
// 2026-05-27 회의록의 결정 — 신호 기반 개입을 *얼굴*로 의인화.
// 추상적인 프로토콜(attention/dwell/reread)이 "촛불이 나타나는 순간"으로 번역됨.
//
// === 개입 프로토콜 (Seam 타겟팅, 디벨롭 §13) ===
// 읽기 관성을 꺾지 않는 '경계면(Seam)'에서만 비선형 삽입:
//   1. annotation — 주석 확정 직후 + 품질 임계 통과 (Active→Constructive 승격)
//        품질 = 행동 휴리스틱 (선택 범위 비율 · 전이 시간 · 산출물 밀도). 실시간 AI/UI 라벨 없이
//        highlight_annotation 페이로드만으로 산출 (디벨롭 §12, G-7).
//   2. reread     — visit_count ≥ 2 (signals.js 의 reread 신호) = 인지적 고립
//   3. welcome    — attention_resume.paused_ms > 30s = 세션 전환점
//   (stuck — 같은 단락 viewport 중앙에 누적 45초. v0.1 추정값, v1 에서 friction percentile 로 대체 예정)
//
// 쿨다운:
//   - 같은 단락 2분 / 전역 25초 (촛불 spam 방지). annotation 은 사용자 능동 행동
//     직후라 전역 쿨다운 우회 (단 per-para·품질 임계가 자연 throttle).
//
// 소멸:
//   - 클릭 → 즉시 후~
//   - 12초 무반응 → 자동 후~
//   - 새 소스 로드 → 제거
//
// 데모 훅 (DevTools): window.__layer2Candle.fire("stuck"|"reread"|"welcome"|"annotation")

import { signalBus, pushSignal } from "./signals.js";

const STUCK_DWELL_MS       = 45000;
const REREAD_VISITS        = 2;
const LONG_PAUSE_MS        = 30000;
const PER_PARA_COOLDOWN_MS = 120000;
const GLOBAL_COOLDOWN_MS   = 25000;
const POLL_INTERVAL_MS     = 4000;
const AUTO_DISMISS_MS      = 12000;
const VISIBLE_RATIO        = 0.5;
// annotation_seam — 주석 품질이 이 점수(0~1)를 넘을 때만 촛불. 낮은 품질("ㅋㅋ",
// blanket highlight)은 거름. 임계·가중치는 1차 추정값 — 실사용 로그 보고 튜닝.
const ANNOTATION_QUALITY_MIN = 0.55;

let readerEl = null;
let enabled = true;
let lastTriggerT = -Infinity;
const lastPerParaT = new Map();
const dwellEntered = new Map(); // paragraph_id → enter timestamp
let activeMount = null;
let pollTimer = null;
let signalSub = null;

export function initCandle({ readerEl: re }) {
  readerEl = re;
  if (signalSub) signalBus.removeEventListener("signal", signalSub);
  signalSub = (e) => onSignal(e.detail);
  signalBus.addEventListener("signal", signalSub);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
}

// Called on every new source load so we reset state and remove any stale candle.
export function resetCandle() {
  dismissActive("source_switch");
  dwellEntered.clear();
  lastPerParaT.clear();
}

export function setCandleEnabled(v) {
  enabled = !!v;
  if (!enabled) dismissActive("disabled");
}

function onSignal(s) {
  if (!enabled) return;
  if (s.type === "highlight_annotation") {
    // annotation_seam — 주석 직후. 품질이 임계를 넘은 (진짜 고민이 담긴) 주석에만
    // 사유 확장 질문을 던져 Active → Constructive 로 끌어올림.
    const q = annotationQuality(s);
    if (q.score >= ANNOTATION_QUALITY_MIN) {
      tryFire(s.paragraph_id, "annotation", { bypassGlobal: true });
    }
  } else if (s.type === "reread" && s.visit_count >= REREAD_VISITS) {
    tryFire(s.paragraph_id, "reread");
  } else if (s.type === "attention_resume" && s.paused_ms >= LONG_PAUSE_MS) {
    const pid = currentParaId();
    if (pid) tryFire(pid, "welcome");
  } else if (s.type === "scroll") {
    // user is moving — clear any in-progress stuck timers for non-visible paras
    pruneNonVisibleEntries();
  }
}

// 주석 품질 휴리스틱 (디벨롭 §12, G-7) — 행동 기반, 실시간 AI/UI 라벨 없이
// highlight_annotation 페이로드 + DOM 으로만 0~1 점수 산출. 문헌(Mason 2024):
// "무엇을 남겼나"보다 "어떻게 남겼나"가 인지 상태를 더 잘 대변.
function annotationQuality(s) {
  // (a) 선택 범위 비율 — 밑줄 텍스트(anchor_text) 길이 / 문단 글자 수.
  //     selective(15~40%) 가 transfer 예측, blanket(>80%) 은 shallow.
  const para = readerEl?.querySelector(`[data-paragraph-id="${s.paragraph_id}"]`);
  const paraLen = para ? para.querySelectorAll("[data-char-index]").length : 0;
  const sel = (s.anchor_text || "").length;
  const ratio = paraLen > 0 ? sel / paraLen : 0;
  let selScore;
  if (ratio < 0.05) selScore = 0.25;       // 거의 안 침
  else if (ratio <= 0.4) selScore = 1.0;   // 핵심 구문 선택
  else if (ratio <= 0.8) selScore = 0.55;
  else selScore = 0.25;                     // blanket

  // (b) 전이 시간 — 밑줄 완료(transition_t) → 주석창 등장(textarea_appeared_t)
  //     사이 머문 시간. 길수록 텍스트를 멘탈 모델로 재구성한 '구성적' 신호.
  const gap =
    (s.textarea_appeared_t ?? 0) - (s.transition_t ?? 0);
  let transScore;
  if (gap < 900) transScore = 0.35;        // 거의 즉시 (반사적)
  else if (gap < 6000) transScore = 0.4 + ((gap - 900) / 5100) * 0.6;
  else transScore = 1.0;                    // 오래 숙고 (cap)

  // (c) 산출물 밀도 — 주석 텍스트 길이 + 반복문자 패널티 ("ㅋㅋㅋㅋ" 거름).
  const text = (s.annotation_text || "").trim();
  const len = text.length;
  const uniq = new Set(text).size;
  const uniqRatio = len > 0 ? uniq / len : 0;
  let outScore;
  if (len < 2) outScore = 0.1;
  else if (uniqRatio < 0.4) outScore = 0.3; // 반복 위주 (저품질)
  else outScore = Math.min(1, 0.45 + len / 40); // 길수록 ↑, cap

  const score = 0.4 * selScore + 0.3 * transScore + 0.3 * outScore;
  return { score, selScore, transScore, outScore, ratio, gap, len };
}

function tick() {
  if (!enabled || !readerEl) return;
  const pid = currentParaId();
  if (!pid) return;
  const now = performance.now();
  const t0 = dwellEntered.get(pid);
  if (!t0) {
    dwellEntered.set(pid, now);
    return;
  }
  if (now - t0 >= STUCK_DWELL_MS) {
    if (tryFire(pid, "stuck")) {
      // reset entry so the next stuck window starts fresh, otherwise we'd
      // immediately retrigger after the per-para cooldown.
      dwellEntered.set(pid, now);
    }
  }
}

function pruneNonVisibleEntries() {
  if (!readerEl) return;
  const visible = new Set();
  const viewRect = readerEl.getBoundingClientRect();
  for (const p of readerEl.querySelectorAll("[data-paragraph-id]")) {
    const r = p.getBoundingClientRect();
    if (r.bottom > viewRect.top && r.top < viewRect.bottom) {
      visible.add(p.dataset.paragraphId);
    }
  }
  for (const pid of Array.from(dwellEntered.keys())) {
    if (!visible.has(pid)) dwellEntered.delete(pid);
  }
}

function currentParaId() {
  if (!readerEl) return null;
  const paras = readerEl.querySelectorAll("[data-paragraph-id]");
  const viewRect = readerEl.getBoundingClientRect();
  const cy = viewRect.top + viewRect.height / 2;
  let best = null;
  let bestDist = Infinity;
  for (const p of paras) {
    const r = p.getBoundingClientRect();
    if (r.bottom < viewRect.top || r.top > viewRect.bottom) continue;
    const visTop = Math.max(r.top, viewRect.top);
    const visBot = Math.min(r.bottom, viewRect.bottom);
    const visH   = Math.max(0, visBot - visTop);
    const enoughOfPara = visH >= r.height * VISIBLE_RATIO;
    const fillsView   = visH >= viewRect.height * VISIBLE_RATIO;
    if (!enoughOfPara && !fillsView) continue;
    const dist = Math.abs((r.top + r.bottom) / 2 - cy);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best?.dataset?.paragraphId || null;
}

function tryFire(pid, reason, opts = {}) {
  const now = performance.now();
  // annotation_seam 은 사용자 능동 행동(주석 확정) 직후라 전역 쿨다운 우회 —
  // 방금 멈춘 자리라 개입 환영도가 가장 높은 순간 (디벨롭 §13). per-para 쿨다운과
  // 품질 임계가 여전히 spam 을 막음.
  if (!opts.bypassGlobal && now - lastTriggerT < GLOBAL_COOLDOWN_MS) return false;
  const lastP = lastPerParaT.get(pid) || -Infinity;
  if (now - lastP < PER_PARA_COOLDOWN_MS) return false;
  lastTriggerT = now;
  lastPerParaT.set(pid, now);
  showCandle(pid, reason);
  pushSignal({ type: "candle_intervene", paragraph_id: pid, reason });
  return true;
}

const LINES = {
  // annotation_seam — 사유 확장 질문 (Active → Constructive 승격, Qlarify 근거)
  annotation: [
    "방금 친 거, 왜 중요하다고 느꼈어?",
    "이걸 네 말로 바꾸면 어떻게 될까?",
    "앞 내용이랑 어떻게 이어지는 것 같아?",
    "여기서 한 줄로 핵심만 뽑으면?",
  ],
  stuck: [
    "이 부분 좀 어렵지? 잠깐 풀어줄까?",
    "여기 한참 머무는 중이야. 거들어볼까?",
    "개념이 빡센 단락 같아. 내가 도와볼게.",
  ],
  reread: [
    "다시 읽고 있네. 정리해줄까?",
    "여기 두 번째지? 같이 풀어볼래?",
    "되돌아왔구나. 이 부분이 핵심일지도.",
  ],
  welcome: [
    "오랜만이야. 어디까지 봤었지?",
    "다시 왔구나. 흐름 짚어줄까?",
    "잠깐 쉬었네. 흘러가던 데서 이어볼게.",
  ],
};

function pickLine(reason) {
  const pool = LINES[reason] || LINES.stuck;
  return pool[Math.floor(Math.random() * pool.length)];
}

const FIG_SVG = `
  <svg class="candle-svg" viewBox="0 0 28 56" aria-hidden="true">
    <rect x="11" y="22" width="6" height="30" rx="1.5" class="candle-stick"/>
    <line x1="14" y1="22" x2="14" y2="18" class="candle-wick"/>
    <g class="candle-flame">
      <path d="M14 6 C 18 12, 19 16, 14 20 C 9 16, 10 12, 14 6 Z" class="candle-flame-outer"/>
      <path d="M14 10 C 16 14, 16.5 16, 14 19 C 11.5 16, 12 14, 14 10 Z" class="candle-flame-inner"/>
    </g>
    <g class="candle-smoke">
      <circle cx="14" cy="8" r="2"/>
      <circle cx="11" cy="3" r="1.6"/>
      <circle cx="17" cy="0" r="1.2"/>
    </g>
  </svg>
`;

function showCandle(pid, reason) {
  dismissActive("replace");
  const para = readerEl.querySelector(`[data-paragraph-id="${pid}"]`);
  if (!para) return;

  const mount = document.createElement("div");
  mount.className = "candle-mount";
  mount.dataset.reason = reason;
  mount.innerHTML = `
    <button type="button" class="candle-fig" aria-label="촛불 닫기">${FIG_SVG}</button>
    <div class="candle-bubble"><span class="candle-line"></span></div>
  `;
  mount.querySelector(".candle-line").textContent = pickLine(reason);

  para.appendChild(mount);
  activeMount = mount;

  // Two RAFs: first lets the browser register the initial style, second triggers the
  // transition. Without this the mount appears already lit.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => mount.classList.add("is-lit")),
  );

  mount.querySelector(".candle-fig")
    .addEventListener("click", () => dismissActive("user"));

  mount.__dismissTimer = setTimeout(
    () => dismissActive("timeout"),
    AUTO_DISMISS_MS,
  );
}

function dismissActive(reason) {
  const m = activeMount;
  if (!m) return;
  activeMount = null;
  clearTimeout(m.__dismissTimer);
  m.classList.add("is-puff");
  pushSignal({ type: "candle_dismiss", reason });
  setTimeout(() => m.remove(), 900);
}

// DevTools / demo hooks
window.__layer2Candle = {
  fire(reason = "stuck") {
    const pid = currentParaId();
    if (!pid) {
      console.warn("[candle] no visible paragraph to anchor to");
      return false;
    }
    // bypass cooldowns for demo
    lastTriggerT = -Infinity;
    lastPerParaT.delete(pid);
    return tryFire(pid, reason);
  },
  enable(v) { setCandleEnabled(v); },
  dismiss() { dismissActive("manual"); },
  state() {
    return {
      enabled,
      lastTriggerT,
      dwellEntered: Array.from(dwellEntered.entries()),
      activeReason: activeMount?.dataset.reason || null,
    };
  },
};
