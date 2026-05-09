// signals.js
// Single source of truth for the SignalLog and signalBus.
// Every meaningful reader event flows through pushSignal().

export const SignalLog = [];
export const signalBus = new EventTarget();

export function pushSignal(sig) {
  const enriched = { t: performance.now(), ...sig };
  SignalLog.push(enriched);
  signalBus.dispatchEvent(new CustomEvent("signal", { detail: enriched }));
  // eslint-disable-next-line no-console
  console.log("[signal]", enriched.type, enriched);
  return enriched;
}

// Expose for ad-hoc inspection in DevTools
window.SignalLog = SignalLog;
window.signalBus = signalBus;
window.pushSignal = pushSignal;

// ---------- Baseline collectors ----------
// Dwell, scroll, reread, mouse trail.
// (Highlighting lives in highlight.js — these never touch each other.)

export function initBaselineCollectors({ readerEl }) {
  initDwellAndReread(readerEl);
  initScroll();
  initMouseTrail();
}

function initDwellAndReread(readerEl) {
  const paras = Array.from(readerEl.querySelectorAll("[data-paragraph-id]"));
  const enteredAt = new Map();
  const totalDwell = new Map();
  const visitedCount = new Map();

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const id = e.target.dataset.paragraphId;
        if (e.isIntersecting && e.intersectionRatio > 0.5) {
          if (!enteredAt.has(id)) {
            enteredAt.set(id, performance.now());
            const visit = (visitedCount.get(id) || 0) + 1;
            visitedCount.set(id, visit);
            if (visit > 1) {
              pushSignal({
                type: "reread",
                paragraph_id: id,
                visit_count: visit,
              });
            }
          }
        } else if (enteredAt.has(id)) {
          const t0 = enteredAt.get(id);
          enteredAt.delete(id);
          const dur = Math.round(performance.now() - t0);
          totalDwell.set(id, (totalDwell.get(id) || 0) + dur);
          if (dur > 400) {
            pushSignal({
              type: "dwell",
              paragraph_id: id,
              duration_ms: dur,
              total_ms: totalDwell.get(id),
            });
          }
        }
      }
    },
    { threshold: [0, 0.5, 1] },
  );
  paras.forEach((p) => io.observe(p));
}

function initScroll() {
  let lastY = window.scrollY;
  let lastT = 0;
  window.addEventListener(
    "scroll",
    () => {
      const now = performance.now();
      if (now - lastT < 200) return;
      lastT = now;
      const y = window.scrollY;
      const dy = y - lastY;
      lastY = y;
      pushSignal({
        type: "scroll",
        y,
        delta: dy,
        direction: dy >= 0 ? "down" : "up",
      });
    },
    { passive: true },
  );
}

function initMouseTrail() {
  let lastT = 0;
  window.addEventListener("mousemove", (e) => {
    const now = performance.now();
    if (now - lastT < 120) return;
    lastT = now;
    pushSignal({
      type: "mouse_trail",
      x: e.clientX,
      y: e.clientY,
    });
  });
}
