// candle.js — Stick Candle (v0.3)
//
// 2026-05-27 회의록의 결정 — 신호 기반 개입을 *얼굴*로 의인화.
// 추상적인 프로토콜(attention/dwell/reread)이 "촛불이 나타나는 순간"으로 번역됨.
//
// === 개입 프로토콜 (Seam 타겟팅, 디벨롭 §13 + 2026-06-03 PDF 정식 조건) ===
// 읽기 관성을 꺾지 않는 '경계면(Seam)'에서만 비선형 삽입:
//   1. annotation — 주석 확정 직후 + 품질 임계 통과 (Active→Constructive 승격)
//        품질 = 행동 휴리스틱 (선택 범위 비율 · 전이 시간 · 산출물 밀도). 실시간 AI/UI 라벨 없이
//        highlight_annotation 페이로드만으로 산출 (디벨롭 §12, G-7).
//   2. isolation  — 인지적 고립: enter_count ≥ 3 AND reverse_rate ≥ 0.5 AND 무흔적.
//        (friction 상위20% 조건은 단계3 마찰 계수 붙으면 결합)
//   3. transition — 세션 전환점: 완전 비활성 180s 복귀 OR 탭 hidden→복귀.
//   (stuck — 같은 단락 viewport 중앙에 누적 45초. 추정값, friction percentile 로 대체 예정)
//
// 쿨다운:
//   - 같은 단락 2분 / 전역 25초 (촛불 spam 방지). annotation·transition 은 사용자
//     능동 행동/복귀 직후라 전역 쿨다운 우회 (단 per-para 쿨다운이 자연 throttle).
//
// 소멸:
//   - 클릭 → 즉시 후~
//   - 12초 무반응 → 자동 후~
//   - 새 소스 로드 → 제거
//
// 데모 훅 (DevTools): window.__layer2Candle.fire("annotation"|"isolation"|"transition"|"stuck")

import { signalBus, pushSignal } from "./signals.js";

const STUCK_DWELL_MS       = 45000;
// isolation_seam — 인지적 고립 (PDF 1차본 정식 조건). 같은 단락을 여러 번
// 역방향으로 되돌아 읽으면서도 아무 흔적(밑줄·주석)을 안 남긴 = 막혔는데 헤매는 상태.
const ISOLATION_REVISITS      = 3;   // enter_count ≥ 3
const ISOLATION_REVERSE_RATE  = 0.5; // 진입의 절반 이상이 위로 되감아 진입
// transition_seam — 세션 전환점. 완전 비활성 180s 복귀 OR 탭 hidden→복귀.
const TRANSITION_IDLE_MS   = 180000; // 완전 비활성 3분 후 복귀
const TAB_RETURN_MS        = 3000;   // 탭을 3s+ 떠났다 복귀
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
// Per-paragraph reading traces, so isolation_seam can tell "wandering with no
// output" (no highlight/annotation) from productive struggle.
const paraTraces = new Map();   // paragraph_id → { highlight, annotation }
let activeMount = null;
let pollTimer = null;
let signalSub = null;
let visListenerBound = false;
let hiddenAt = 0;

export function initCandle({ readerEl: re }) {
  readerEl = re;
  if (signalSub) signalBus.removeEventListener("signal", signalSub);
  signalSub = (e) => onSignal(e.detail);
  signalBus.addEventListener("signal", signalSub);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  // transition_seam (tab return): bind once. A long hide → re-show is a session
  // transition — surface a re-orienting prompt on the paragraph in view.
  if (!visListenerBound) {
    visListenerBound = true;
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
}

function onVisibilityChange() {
  if (!enabled) return;
  if (document.hidden) {
    hiddenAt = performance.now();
  } else if (hiddenAt) {
    const away = performance.now() - hiddenAt;
    hiddenAt = 0;
    if (away >= TAB_RETURN_MS) {
      const pid = currentParaId();
      if (pid) tryFire(pid, "transition", { bypassGlobal: true });
    }
  }
}

// Called on every new source load so we reset state and remove any stale candle.
export function resetCandle() {
  dismissActive("source_switch");
  dwellEntered.clear();
  lastPerParaT.clear();
  paraTraces.clear();
}

function recordTrace(pid, kind) {
  if (!pid) return;
  const t = paraTraces.get(pid) || { highlight: false, annotation: false };
  t[kind] = true;
  paraTraces.set(pid, t);
}

function hasTrace(pid) {
  const t = paraTraces.get(pid);
  return !!(t && (t.highlight || t.annotation));
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
    recordTrace(s.paragraph_id, "annotation");
    const q = annotationQuality(s);
    if (q.score >= ANNOTATION_QUALITY_MIN) {
      tryFire(s.paragraph_id, "annotation", { bypassGlobal: true });
    }
  } else if (s.type === "highlight_underline") {
    // 흔적 기록 (isolation_seam 의 "무흔적" 판정용).
    recordTrace(s.paragraph_id, "highlight");
  } else if (s.type === "reread") {
    // isolation_seam — 반복 재진입(enter_count ≥ 3) + 역방향 우세(reverse_rate ≥ 0.5)
    // + 무흔적. 막혔는데 산출물 없이 헤매는 상태에서만 진단형 개입.
    // (friction 상위20% 조건은 단계3 마찰 계수 붙으면 결합 — 지금은 행동 조건만.)
    const enters = s.enter_count || s.visit_count || 0;
    if (
      enters >= ISOLATION_REVISITS &&
      (s.reverse_rate || 0) >= ISOLATION_REVERSE_RATE &&
      !hasTrace(s.paragraph_id)
    ) {
      tryFire(s.paragraph_id, "isolation");
    }
  } else if (s.type === "attention_resume" && s.paused_ms >= TRANSITION_IDLE_MS) {
    // transition_seam — 완전 비활성 180s 후 복귀 (세션 전환점).
    const pid = currentParaId();
    if (pid) tryFire(pid, "transition", { bypassGlobal: true });
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
  // isolation_seam — 막혔는데 헤매는 자리. 구조를 짚어주는 진단형 (D'Mello 근거)
  isolation: [
    "여기 자꾸 되돌아오네. 핵심 주장부터 같이 짚어볼까?",
    "이 부분에서 막힌 것 같아. 구조를 한 번 풀어줄까?",
    "세 번째 왔구나. 헷갈리는 데를 같이 정리해보자.",
  ],
  // transition_seam — 휴식 후 복귀. 요약·환기 (Hefter: 흐름 보존)
  transition: [
    "다시 왔구나. 어디까지 봤는지 짚어줄까?",
    "오랜만이야. 흐름 한 번 정리해줄까?",
    "잠깐 쉬었네. 지난번 오래 붙잡았던 데부터 이어보자.",
  ],
  stuck: [
    "이 부분 좀 어렵지? 잠깐 풀어줄까?",
    "여기 한참 머무는 중이야. 거들어볼까?",
    "개념이 빡센 단락 같아. 내가 도와볼게.",
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

  // Capture paragraph text BEFORE building the mount. Used as the 티키타카 anchor.
  const paraText = (para.textContent || "").slice(0, 600);
  const line = pickLine(reason);

  const mount = document.createElement("div");
  mount.className = "candle-mount";
  mount.dataset.reason = reason;
  mount.innerHTML = `
    <button type="button" class="candle-fig" aria-label="촛불 닫기">${FIG_SVG}</button>
    <div class="candle-bubble">
      <span class="candle-line"></span>
      <button type="button" class="candle-chat-btn">💬 대화</button>
    </div>
  `;
  mount.querySelector(".candle-line").textContent = line;

  // position: fixed on <body> so the candle floats above the reader's overflow
  // /stacking context. Place it in the right margin of the paragraph; if that
  // would run off-screen (narrow viewport / board mode), flip to the left.
  const r = para.getBoundingClientRect();
  const W = 200;
  const GAP = 24;
  let left = r.right + GAP;
  if (left + W + 16 > window.innerWidth) {
    left = Math.max(12, r.left - W - GAP);
  }
  const top = Math.max(8, Math.min(r.top - 4, window.innerHeight - 120));
  mount.style.left = `${Math.round(left)}px`;
  mount.style.top = `${Math.round(top)}px`;

  document.body.appendChild(mount);
  activeMount = mount;

  // Two RAFs: first lets the browser register the initial style, second triggers the
  // transition. Without this the mount appears already lit.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => mount.classList.add("is-lit")),
  );

  mount.querySelector(".candle-fig")
    .addEventListener("click", () => dismissActive("user"));

  // 대화 버튼 → 티키타카 요청 발화 (chat.js 가 구독) + 촛불은 후~.
  mount.querySelector(".candle-chat-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    pushSignal({
      type: "candle_chat_request",
      paragraph_id: pid,
      reason,
      line,
      para_text: paraText,
    });
    dismissActive("chat");
  });

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
      paraTraces: Array.from(paraTraces.entries()),
      activeReason: activeMount?.dataset.reason || null,
    };
  },
};
