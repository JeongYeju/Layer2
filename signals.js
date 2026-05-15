// signals.js
// Single source of truth for the SignalLog and signalBus.
// Every meaningful reader event flows through pushSignal().

export const SignalLog = [];
export const signalBus = new EventTarget();

let _trailEnabled = true;
let _gesturesEnabled = true;
let _snapBlockUntil = 0; // ms timestamp; while now < this, trail snap is suppressed
let _clearTrail = null;  // set by initMouseTrailVisual
const _persistentMarks = []; // [{ wordKeys: Set<string>, element: HTMLElement }]
const _wordSeg = new Intl.Segmenter("ko", { granularity: "word" });
export function setTrailEnabled(v) {
  _trailEnabled = v;
  if (!v && _clearTrail) _clearTrail();
}
export function setGesturesEnabled(v) {
  _gesturesEnabled = v;
}

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
  initMouseTrailVisual();
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

function initMouseTrailVisual() {
  const inkLayer = document.getElementById("ink-layer");
  if (!inkLayer) return;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const TRAIL_MS = 1100;       // how long a point lives before fully fading
  const MIN_DIST = 3;          // skip points closer than this to the previous smoothed point
  const SMOOTH_ALPHA = 0.35;   // EMA weight on raw input — lower = smoother
  const BASE_ALPHA = 0.32;     // newest segment opacity (lighter than before)
  const SNAP_OFFSET = 2;       // pixels below glyph bottom — where the trail "rests" on a line
  const SNAP_DURATION = 280;   // ms — ease-in-out duration when entering/leaving text

  // Per-segment <line> children inside a <g>, so each can fade on its own
  // schedule based on age (slow draws → slow gradual dissolve, fast draws →
  // everything fades at once shortly after).
  const trailGroup = document.createElementNS(SVG_NS, "g");
  trailGroup.setAttribute("class", "mouse-trail-group");
  inkLayer.appendChild(trailGroup);

  // Each point: { x, actualY, snapY, t }
  // actualY is the smoothed mouse position; snapY is the line where the trail
  // would rest if snapped to the underline at that moment (or actualY when off
  // text). Both are stored so we can interpolate per-frame via currentSnap.
  let trailPts = [];
  let smoothedLast = null;
  let circleTimer = null;

  // Snap interpolation — ease-in-out animation toward target.
  let currentSnap = 0;
  let snapTarget = 0;
  let snapAnim = null; // { from, to, startT, duration }

  _clearTrail = () => {
    trailPts = [];
    smoothedLast = null;
    while (trailGroup.firstChild) trailGroup.removeChild(trailGroup.firstChild);
    trailGroup.classList.remove("mouse-trail-group--circle");
  };

  function findGraphemeAt(x, y) {
    const stack = document.elementsFromPoint(x, y);
    return stack.find(
      (el) => el.matches && el.matches("[data-char-index]"),
    );
  }

  window.addEventListener("mousemove", (e) => {
    if (!_trailEnabled) {
      smoothedLast = null;
      return;
    }
    const now = performance.now();

    // EMA lowpass — filters hand jitter, preserves direction.
    let sx, sy;
    if (smoothedLast) {
      sx = smoothedLast.x + (e.clientX - smoothedLast.x) * SMOOTH_ALPHA;
      sy = smoothedLast.y + (e.clientY - smoothedLast.y) * SMOOTH_ALPHA;
      if (Math.hypot(sx - smoothedLast.x, sy - smoothedLast.y) < MIN_DIST) {
        smoothedLast = { x: sx, y: sy };
        return;
      }
    } else {
      sx = e.clientX;
      sy = e.clientY;
    }
    smoothedLast = { x: sx, y: sy };

    // Snap detection — if the cursor is over a glyph, the trail will glide
    // toward the underline line of that glyph.
    const span = findGraphemeAt(sx, sy);
    let snapY = sy;
    let overText = false;
    if (span) {
      const rect = span.getBoundingClientRect();
      snapY = rect.bottom + SNAP_OFFSET;
      overText = true;
    }

    // Start a new ease-in-out animation whenever the snap target flips.
    // While _snapBlockUntil is in the future (just after a circle_gesture),
    // suppress snap so the user can see their gesture shape, not a row of
    // underline-aligned segments.
    const snapAllowed = now >= _snapBlockUntil;
    const desired = overText && snapAllowed ? 1 : 0;
    if (desired !== snapTarget) {
      snapAnim = {
        from: currentSnap,
        to: desired,
        startT: now,
        duration: SNAP_DURATION,
      };
      snapTarget = desired;
    }

    trailPts.push({ x: sx, actualY: sy, snapY, t: now });
  });

  signalBus.addEventListener("signal", (e) => {
    if (e.detail.type !== "circle_gesture") return;
    // Visually mark the trail as a gesture (green tint).
    trailGroup.classList.add("mouse-trail-group--circle");
    if (circleTimer) clearTimeout(circleTimer);
    circleTimer = setTimeout(() => {
      trailGroup.classList.remove("mouse-trail-group--circle");
    }, 1500);
    // Force-release snap so the green trail reveals the actual circle shape
    // instead of staying glued to the underline of whatever line was crossed.
    const now = performance.now();
    snapAnim = { from: currentSnap, to: 0, startT: now, duration: 120 };
    snapTarget = 0;
    _snapBlockUntil = now + 800;
  });

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function renderFrame() {
    const now = performance.now();

    // Advance the snap easing animation.
    if (snapAnim) {
      const t = (now - snapAnim.startT) / snapAnim.duration;
      if (t >= 1) {
        currentSnap = snapAnim.to;
        snapAnim = null;
      } else {
        currentSnap =
          snapAnim.from + (snapAnim.to - snapAnim.from) * easeInOut(t);
      }
    }

    // Drop expired points.
    trailPts = trailPts.filter((p) => now - p.t < TRAIL_MS);

    // Reconcile <line> children — keep the pool sized to segCount to avoid
    // per-frame allocation churn.
    const segCount = Math.max(0, trailPts.length - 1);
    const kids = trailGroup.children;
    while (kids.length < segCount) {
      const ln = document.createElementNS(SVG_NS, "line");
      ln.setAttribute("class", "mouse-trail-seg");
      trailGroup.appendChild(ln);
    }
    while (kids.length > segCount) {
      trailGroup.removeChild(kids[kids.length - 1]);
    }

    for (let i = 0; i < segCount; i++) {
      const p1 = trailPts[i];
      const p2 = trailPts[i + 1];
      // Snap-interpolated y per point.
      const y1 = p1.actualY + (p1.snapY - p1.actualY) * currentSnap;
      const y2 = p2.actualY + (p2.snapY - p2.actualY) * currentSnap;
      // Smoothstep fade — quiet ease near the head, faster falloff toward
      // the tail, no hard cutoff at the end.
      const age = (now - p1.t) / TRAIL_MS;
      const remaining = Math.max(0, 1 - age);
      const eased = remaining * remaining * (3 - 2 * remaining);
      const opacity = BASE_ALPHA * eased;

      const ln = kids[i];
      ln.setAttribute("x1", p1.x.toFixed(1));
      ln.setAttribute("y1", y1.toFixed(1));
      ln.setAttribute("x2", p2.x.toFixed(1));
      ln.setAttribute("y2", y2.toFixed(1));
      ln.setAttribute("stroke-opacity", opacity.toFixed(3));
    }

    requestAnimationFrame(renderFrame);
  }
  requestAnimationFrame(renderFrame);
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
    if (!_gesturesEnabled) {
      trail = [];
      return;
    }
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

    // Identify the words the loop just enclosed. Slight ellipse (vertically
    // tighter) matches text geometry better than a perfect circle. Tolerance
    // factor lets us capture glyphs whose centers sit just outside the strict
    // geometric circle but were clearly part of the user's loop.
    const tolR = meanR * 1.15;
    const tolRy = meanR * 0.85;
    const enclosed = identifyEnclosedSpans(cx, cy, tolR, tolRy);
    let enclosedInfo = null;
    let visualAdded = false;
    if (enclosed.length > 0) {
      enclosedInfo = summarizeEnclosed(enclosed);
      if (enclosedInfo) visualAdded = drawPersistentWordCircle(enclosedInfo);
    }

    pushSignal({
      type: "circle_gesture",
      cx: Math.round(cx),
      cy: Math.round(cy),
      radius: Math.round(meanR),
      coverage_deg: Math.round(coverage),
      point_count: trail.length,
      enclosed_text: enclosedInfo?.text || "",
      enclosed_paragraph: enclosedInfo?.paragraphId || null,
      enclosed_char_range: enclosedInfo?.charRange || null,
      enclosed_word_count: enclosedInfo?.words?.length || 0,
      visual_added: visualAdded, // false = duplicate of an existing mark
    });
  });
}

// Return all grapheme spans whose center sits inside the (cx, cy, rx, ry) ellipse.
function identifyEnclosedSpans(cx, cy, rx, ry) {
  const spans = document.querySelectorAll(".para [data-char-index]");
  const out = [];
  for (const span of spans) {
    const rect = span.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const sx = (rect.left + rect.right) / 2;
    const sy = (rect.top + rect.bottom) / 2;
    const dx = sx - cx;
    const dy = sy - cy;
    if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
      const para = span.closest("[data-paragraph-id]");
      if (!para) continue;
      out.push({
        span,
        paragraphId: para.dataset.paragraphId,
        charIndex: parseInt(span.dataset.charIndex, 10),
      });
    }
  }
  return out;
}

// Take the char-level hits and expand them to whole-word units. Output
// includes every grapheme span belonging to each enclosing word, so the
// final visual hugs whole words instead of just the chars the gesture
// happened to clip.
function summarizeEnclosed(enclosed) {
  const byPara = new Map();
  for (const e of enclosed) {
    if (!byPara.has(e.paragraphId)) byPara.set(e.paragraphId, []);
    byPara.get(e.paragraphId).push(e);
  }
  let bestPid = null;
  let bestCount = 0;
  for (const [pid, list] of byPara) {
    if (list.length > bestCount) {
      bestPid = pid;
      bestCount = list.length;
    }
  }
  if (!bestPid) return null;

  const para = document.querySelector(`[data-paragraph-id="${bestPid}"]`);
  if (!para) return null;

  // Index spans by charIndex and reconstruct paragraph text for segmentation.
  const allSpans = Array.from(para.querySelectorAll("[data-char-index]"));
  const spanByCi = new Map();
  for (const s of allSpans) {
    spanByCi.set(parseInt(s.dataset.charIndex, 10), s);
  }
  const text = allSpans.map((s) => s.textContent).join("");

  // Expand: a word is included if any enclosed char lands inside it.
  const enclosedCi = new Set(byPara.get(bestPid).map((e) => e.charIndex));
  const words = [];
  const wordKeys = new Set();
  for (const seg of _wordSeg.segment(text)) {
    if (!seg.isWordLike) continue;
    const start = seg.index;
    const end = seg.index + seg.segment.length;
    let touched = false;
    for (const ci of enclosedCi) {
      if (ci >= start && ci < end) {
        touched = true;
        break;
      }
    }
    if (touched) {
      words.push({ startChar: start, endChar: end, text: seg.segment });
      wordKeys.add(`${bestPid}:${start}-${end}`);
    }
  }
  if (words.length === 0) return null;

  // Collect every grapheme span belonging to the expanded words.
  const wordSpans = [];
  for (const w of words) {
    for (let i = w.startChar; i < w.endChar; i++) {
      const s = spanByCi.get(i);
      if (s) wordSpans.push(s);
    }
  }

  return {
    paragraphId: bestPid,
    words,
    wordKeys,
    spans: wordSpans,
    text: words.map((w) => w.text).join(" "),
    charRange: [words[0].startChar, words[words.length - 1].endChar - 1],
  };
}

// Append a faint gray ellipse fitted around the enclosed *words*. Anchored
// to the paragraph (position: relative) so it scrolls/moves with the text.
// Dedup: if the new mark's word-set overlaps with an existing one (Jaccard
// >= 0.6), skip adding a second visual so repeat gestures don't pile up.
// Returns true if a new mark was added.
function drawPersistentWordCircle(summary) {
  if (!summary || summary.spans.length === 0) return false;

  for (const m of _persistentMarks) {
    let intersection = 0;
    for (const k of summary.wordKeys) if (m.wordKeys.has(k)) intersection++;
    const union = m.wordKeys.size + summary.wordKeys.size - intersection;
    if (union > 0 && intersection / union >= 0.6) return false;
  }

  const para = document.querySelector(
    `[data-paragraph-id="${summary.paragraphId}"]`,
  );
  if (!para) return false;
  const paraRect = para.getBoundingClientRect();

  let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
  for (const span of summary.spans) {
    const r = span.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    minL = Math.min(minL, r.left);
    minT = Math.min(minT, r.top);
    maxR = Math.max(maxR, r.right);
    maxB = Math.max(maxB, r.bottom);
  }
  if (!isFinite(minL)) return false;

  const padX = 6;
  const padY = 3;
  const mark = document.createElement("div");
  mark.className = "word-circle-mark";
  mark.style.position = "absolute";
  mark.style.left = `${minL - paraRect.left - padX}px`;
  mark.style.top = `${minT - paraRect.top - padY}px`;
  mark.style.width = `${maxR - minL + padX * 2}px`;
  mark.style.height = `${maxB - minT + padY * 2}px`;
  para.appendChild(mark);

  _persistentMarks.push({ wordKeys: summary.wordKeys, element: mark });
  return true;
}
