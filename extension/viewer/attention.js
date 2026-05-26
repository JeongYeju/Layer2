// attention.js
// Reading-attention gate. A reading session auto-starts when a source loads,
// but we still want to know whether the reader is actually *reading* or has
// stepped away. When attention lapses we gently blur the body text (a
// "독서 중단 지점"); real reading activity brings it back.
//
// Blur (rest) triggers:
//   - tab/window inactive for HIDDEN_BLUR_MS  (reason "away")
//   - no activity for IDLE_BLUR_MS while visible (reason "idle")
// Resume triggers:
//   - scroll / wheel / key / click  → immediate
//   - cursor movement               → only after RESUME_MOVE_PX of motion
// The blur itself eases in gradually (CSS transition on .article).

import { pushSignal } from "./signals.js";

const HIDDEN_BLUR_MS = 5000;   // tab inactive this long → rest
const IDLE_BLUR_MS = 20000;    // visible but no activity this long → rest
const RESUME_MOVE_PX = 200;    // accumulated cursor motion needed to resume
                               // (deliberate scribble, not a stray nudge)
const BLUR_IN_DUR = "2.4s";    // gradual blur-in
const BLUR_OUT_FAST = "0.18s"; // scroll/key/click resume
const BLUR_OUT_SMOOTH = "0.6s"; // cursor resume

let readerEl = null;
let resting = false;
let lastActivityT = 0;
let restStartT = 0;
let moveAccum = 0;
let idleTimer = null;
let awayTimer = null;

export function initAttention(opts) {
  readerEl = opts.readerEl;
  lastActivityT = performance.now();
  armIdleTimer();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) scheduleAwayRest();
    else {
      cancelAwayRest();
      bumpActivity();
    }
  });
  window.addEventListener("blur", scheduleAwayRest);
  window.addEventListener("focus", () => {
    cancelAwayRest();
    bumpActivity();
  });

  window.addEventListener("mousemove", onMouseMove, { passive: true });
  window.addEventListener("scroll", () => resumeOrActivity("scroll", BLUR_OUT_FAST), {
    passive: true,
  });
  window.addEventListener("wheel", () => resumeOrActivity("scroll", BLUR_OUT_FAST), {
    passive: true,
  });
  window.addEventListener("keydown", () => resumeOrActivity("key", BLUR_OUT_FAST));
  window.addEventListener("mousedown", () => resumeOrActivity("click", BLUR_OUT_FAST));
  window.addEventListener(
    "touchstart",
    () => resumeOrActivity("touch", BLUR_OUT_FAST),
    { passive: true },
  );
}

// Called when a new source loads — always return to a clear reading state.
export function wakeReading() {
  cancelAwayRest();
  if (resting) resumeRest("source_switch", BLUR_OUT_FAST);
  else bumpActivity();
}

function armIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!resting && !document.hidden) enterRest("idle");
  }, IDLE_BLUR_MS);
}

// Activity while reading: refresh the idle countdown.
function bumpActivity() {
  lastActivityT = performance.now();
  if (!resting) armIdleTimer();
}

function onMouseMove(e) {
  if (resting) {
    // Cursor resume is deliberate, not instant: require some real motion.
    moveAccum += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
    if (moveAccum >= RESUME_MOVE_PX) resumeRest("cursor", BLUR_OUT_SMOOTH);
    return;
  }
  bumpActivity();
}

function resumeOrActivity(reason, durOut) {
  if (resting) resumeRest(reason, durOut);
  else bumpActivity();
}

function scheduleAwayRest() {
  clearTimeout(awayTimer);
  awayTimer = setTimeout(() => {
    if (document.hidden || !document.hasFocus()) enterRest("away");
  }, HIDDEN_BLUR_MS);
}

function cancelAwayRest() {
  clearTimeout(awayTimer);
}

function enterRest(reason) {
  if (resting || !readerEl) return;
  resting = true;
  restStartT = performance.now();
  moveAccum = 0;
  clearTimeout(idleTimer);
  readerEl.style.setProperty("--rest-dur", BLUR_IN_DUR);
  readerEl.classList.add("is-resting");
  pushSignal({
    type: "attention_pause",
    reason,
    idle_ms: Math.round(performance.now() - lastActivityT),
  });
}

function resumeRest(reason, durOut) {
  if (!resting || !readerEl) return;
  resting = false;
  const pausedMs = Math.round(performance.now() - restStartT);
  moveAccum = 0;
  readerEl.style.setProperty("--rest-dur", durOut);
  readerEl.classList.remove("is-resting");
  bumpActivity();
  pushSignal({ type: "attention_resume", reason, paused_ms: pausedMs });
}
