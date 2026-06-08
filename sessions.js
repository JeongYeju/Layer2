// sessions.js — 다중 세션 누적 + 거시 리포트 (Phase 2.5.6 Macro)
//
// 세션이 끝날 때마다 그 세션의 요약(언제·무엇·마찰·ICAP 분포)을 localStorage
// 에 쌓는다. 단일 브라우저 안에서 다회독 데이터가 모이면, 시간대별 인지 리듬·
// 마찰 추이·관심사 같은 거시 리포트가 DB 없이 가능하다 (디벨롭 §6).
//   window.__layer2Sessions.{ save, load, clear, summary }

import { signalBus } from "./signals.js";
import { buildSessionExport } from "./sidebar.js";
import { refineExport } from "./interpret.js";

const KEY = "layer2.sessions.v1";
const MAX = 80;

export function initSessions() {
  signalBus.addEventListener("signal", (e) => {
    if (e.detail?.type === "session_end") {
      // session_end fires before the SignalLog window closes — save the digest now.
      setTimeout(saveCurrentSession, 0);
    }
  });
  window.__layer2Sessions = {
    save: saveCurrentSession,
    load: loadSessions,
    clear: clearSessions,
    summary: () => summarizeMacro(loadSessions()),
  };
}

export function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* quota — best effort */
  }
}

export function clearSessions() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// Append a raw summary object (used by demo seeding too).
export function pushSummary(summary) {
  if (!summary) return null;
  const list = loadSessions();
  list.push(summary);
  persist(list);
  return summary;
}

export function saveCurrentSession() {
  let exp;
  try {
    exp = buildSessionExport();
  } catch {
    return null;
  }
  if (!exp || !exp.source) return null;
  const s = summarizeSession(exp);
  return s ? pushSummary(s) : null;
}

function summarizeSession(exp) {
  const digest = refineExport(exp);
  const paras = (digest && digest.paragraphs) || [];
  if (!paras.length) return null;
  const frs = paras.map((p) => p.friction).filter((n) => typeof n === "number");
  const mean = frs.length ? frs.reduce((a, b) => a + b, 0) / frs.length : 0;
  const max = frs.length ? Math.max(...frs) : 0;
  const high = paras.filter((p) => p.friction_high).length;
  // 세션 간 비교 가능한 *절대* 지표. 단락별 friction 은 문서 내 z-score 라
  // 한 세션 안에서 평균이 항상 ~0 → 세션 대표값으로 못 쓴다(추이 그래프가 평평).
  // 대신 "이 글에서 마찰 높은(상위20%) 단락의 비율"을 쓰면 세션끼리 비교된다.
  const effortFrac = paras.length ? +(high / paras.length).toFixed(3) : 0;
  const icap = { P: 0, A: 0, C: 0, I: 0 };
  for (const p of paras) icap[p.icap_mode] = (icap[p.icap_mode] || 0) + 1;
  const t = nowMs();
  return {
    id: `${exp.session?.source_id || "s"}_${t}`,
    t,
    hour: new Date(t).getHours(),
    source_id: exp.session?.source_id || null,
    source_title: exp.session?.source_title || "(제목 없음)",
    duration_ms: exp.session?.duration_ms || 0,
    paragraphs: paras.length,
    // mean/max 는 참고용(문서 내 상대값). effort_frac 가 세션 간 비교/추이용.
    friction: { mean: +mean.toFixed(2), max: +max.toFixed(2), high, effort_frac: effortFrac },
    icap,
  };
}

// Date.now() guarded (the build never runs these in a script sandbox, but be safe).
function nowMs() {
  try {
    return Date.now();
  } catch {
    return 0;
  }
}

// 세션의 절대 마찰 지표(0~1). effort_frac 가 있으면 그걸, 없으면(구버전/시드)
// high/paragraphs 로 보정. friction.mean 은 ~0 이라 절대 쓰지 않는다.
export function effortOf(s) {
  if (typeof s.friction?.effort_frac === "number") return s.friction.effort_frac;
  const n = s.paragraphs || 0;
  return n ? (s.friction?.high || 0) / n : 0;
}

// Macro roll-up across all stored sessions.
export function summarizeMacro(sessions) {
  const n = sessions.length;
  const byHour = {}; // hour → { count, frictionSum, deep }
  for (const s of sessions) {
    const h = s.hour ?? 0;
    (byHour[h] = byHour[h] || { count: 0, frictionSum: 0, deep: 0 });
    byHour[h].count += 1;
    byHour[h].frictionSum += effortOf(s);
    byHour[h].deep += s.friction?.high || 0;
  }
  const trend = sessions.map((s) => ({
    t: s.t,
    title: s.source_title,
    mean: effortOf(s),
  }));
  const totalMs = sessions.reduce((a, s) => a + (s.duration_ms || 0), 0);
  const titles = {};
  for (const s of sessions) titles[s.source_title] = (titles[s.source_title] || 0) + 1;
  const icapTotal = { P: 0, A: 0, C: 0, I: 0 };
  for (const s of sessions)
    for (const k of ["P", "A", "C", "I"]) icapTotal[k] += s.icap?.[k] || 0;
  return { n, byHour, trend, totalMs, titles, icapTotal, sessions };
}
