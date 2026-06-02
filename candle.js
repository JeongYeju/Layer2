// candle.js — Stick Candle (초안 v0.1)
//
// 2026-05-27 회의록의 결정 — 신호 기반 개입을 *얼굴*로 의인화.
// 추상적인 프로토콜(attention/dwell/reread)이 "촛불이 나타나는 순간"으로 번역됨.
//
// === 개입 프로토콜 ===
// 트리거 (어느 신호 조합 → 촛불 등장):
//   1. 막힘   stuck         — 같은 단락 viewport 중앙에 누적 45초
//   2. 되돌아가기 reread    — visit_count ≥ 2 (signals.js 의 reread 신호)
//   3. 휴식 후 복귀 welcome — attention_resume.paused_ms > 30s
//
// 쿨다운:
//   - 같은 단락 2분 / 전역 25초 (촛불 spam 방지)
//
// 소멸:
//   - 클릭 → 즉시 후~
//   - 12초 무반응 → 자동 후~
//   - 새 소스 로드 → 제거
//
// 데모 훅 (DevTools): window.__layer2Candle.fire("stuck"|"reread"|"welcome")

import { signalBus, pushSignal } from "./signals.js";

const STUCK_DWELL_MS       = 45000;
const REREAD_VISITS        = 2;
const LONG_PAUSE_MS        = 30000;
const PER_PARA_COOLDOWN_MS = 120000;
const GLOBAL_COOLDOWN_MS   = 25000;
const POLL_INTERVAL_MS     = 4000;
const AUTO_DISMISS_MS      = 12000;
const VISIBLE_RATIO        = 0.5;

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
  if (s.type === "reread" && s.visit_count >= REREAD_VISITS) {
    tryFire(s.paragraph_id, "reread");
  } else if (s.type === "attention_resume" && s.paused_ms >= LONG_PAUSE_MS) {
    const pid = currentParaId();
    if (pid) tryFire(pid, "welcome");
  } else if (s.type === "scroll") {
    // user is moving — clear any in-progress stuck timers for non-visible paras
    pruneNonVisibleEntries();
  }
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

function tryFire(pid, reason) {
  const now = performance.now();
  if (now - lastTriggerT < GLOBAL_COOLDOWN_MS) return false;
  const lastP = lastPerParaT.get(pid) || -Infinity;
  if (now - lastP < PER_PARA_COOLDOWN_MS) return false;
  lastTriggerT = now;
  lastPerParaT.set(pid, now);
  showCandle(pid, reason);
  pushSignal({ type: "candle_intervene", paragraph_id: pid, reason });
  return true;
}

const LINES = {
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
