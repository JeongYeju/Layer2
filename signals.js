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
  initGestureDetector();
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

function initGestureDetector() {
  // Sliding window of recent mouse positions used for shape recognition.
  // A gesture fires when points in the last WINDOW_MS form a near-complete circle:
  //   - consistent distance from centroid  (std/mean < CIRCULARITY_THRESHOLD)
  //   - sweeps >= COVERAGE_DEG degrees
  //   - radius >= MIN_RADIUS px  (filters out tiny wiggles)
  const WINDOW_MS = 2000;
  const MIN_POINTS = 20;
  const MIN_RADIUS = 30;
  const CIRCULARITY_THRESHOLD = 0.35;
  const COVERAGE_DEG = 300;
  const COOLDOWN_MS = 1500;

  let trail = [];
  let lastFiredT = -Infinity;

  window.addEventListener("mousemove", (e) => {
    const now = performance.now();
    trail.push({ x: e.clientX, y: e.clientY, t: now });

    // Drop points outside the window
    const cutoff = now - WINDOW_MS;
    trail = trail.filter((p) => p.t >= cutoff);

    if (trail.length < MIN_POINTS) return;
    if (now - lastFiredT < COOLDOWN_MS) return;

    // Centroid
    let cx = 0, cy = 0;
    for (const p of trail) { cx += p.x; cy += p.y; }
    cx /= trail.length;
    cy /= trail.length;

    // Radius consistency
    const radii = trail.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const meanR = radii.reduce((a, b) => a + b, 0) / radii.length;
    if (meanR < MIN_RADIUS) return;
    const stdR = Math.sqrt(
      radii.map((r) => (r - meanR) ** 2).reduce((a, b) => a + b, 0) / radii.length,
    );
    if (stdR / meanR > CIRCULARITY_THRESHOLD) return;

    // Angular coverage — find the largest gap between consecutive angles
    const angles = trail
      .map((p) => (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI)
      .sort((a, b) => a - b);
    let maxGap = angles[0] + 360 - angles[angles.length - 1];
    for (let i = 1; i < angles.length; i++) {
      maxGap = Math.max(maxGap, angles[i] - angles[i - 1]);
    }
    const coverage = 360 - maxGap;
    if (coverage < COVERAGE_DEG) return;

    lastFiredT = now;
    pushSignal({
      type: "circle_gesture",
      cx: Math.round(cx),
      cy: Math.round(cy),
      radius: Math.round(meanR),
      coverage_deg: Math.round(coverage),
      point_count: trail.length,
    });
  });
}
