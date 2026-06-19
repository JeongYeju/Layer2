// demo-director.js — 발표 데모 "연출 모드(Director Mode)"
//
// 문제: 사람이 실시간으로 스크롤·타이핑한 걸 그대로 녹화하면 스크롤이 뚝뚝
// 끊기고 타이핑이 들쭉날쭉해 어색하다.
// 해법: 모션(스크롤·밑줄·주석 타이핑·촛불·맵·보드 전환)은 전부 부드럽게 스크립트로
// 짜두고, "타이밍"만 발표자가 스페이스바로 넘긴다. 화면은 늘 매끄럽고 말이랑 안 어긋남.
//
// 두 가지 방식 — 같은 비트 시퀀스를 공유:
//   STEP : window.__layer2Director.start()        → Space/→ 로 비트 하나씩 (연습·라이브)
//   AUTO : window.__layer2Director.start({auto:true, hud:false})  → 끝까지 자동 (Playwright mp4 녹화)
//
// 진짜 앱 위에서 돈다. 밑줄·주석은 실제 신호(pushSignal)도 함께 흘려서 마찰·멘탈맵이
// 가짜가 아니라 실제로 계산된다. 촛불만 대본 문구를 정확히 띄우려고 강제 발화한다.

import { pushSignal } from "./signals.js";
import { wakeReading } from "./attention.js";

// ── 타이밍 상수 (드라이런 후 여기서 튜닝) ──────────────────────────────
const T = {
  scrollDrift: 2400,   // 읽는 듯 천천히 흐르는 드리프트 스크롤
  scrollTo: 950,       // 특정 단락으로 이동
  underlinePerChar: 16,// 밑줄이 그어지는 한 글자 간격(ms)
  typeBase: 58,        // 타이핑 한 글자 기본 간격(ms)
  typeJitter: 46,      // ± 지터
  autoGap: 1500,       // AUTO 모드에서 비트 사이 간격
};

// ── 대본 촛불 문구 (15일-script.md 와 동일) ──────────────────────────
const CANDLE_LINE_1 =
  "방금 단 주석에서 한 박자 쉬어가셨네요. 그 생각이랑 이어지는 문단, 지금 보니 어때요?";
const CANDLE_LINE_2 =
  "이 단락, 방금 몇 번을 오갔네요. 흐름 다시 잡게 지금까지 쌓인 개념 지도를 옆에 잠깐 펼쳐볼까요?";

const ANNOTATION_TEXT = "분자끼리 끌어당기는 힘 = 표면장력. 그래서 둥글어지는구나.";

const SVG_NS = "http://www.w3.org/2000/svg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const raf2 = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

let readerEl = null;
let cur = -1;          // 현재 비트 인덱스
let beats = [];
let pick = {};         // 단락 인덱스 선택
let running = false;    // 비트 실행 중(중복 입력 차단)
let armed = false;     // 키 입력 대기 상태
let hudEl = null;
let awakeTimer = null; // attention 블러 방지(스크롤이 div라 window scroll 이벤트 안 옴)

const paras = () => [...(readerEl?.querySelectorAll(".para[data-paragraph-id]") || [])];

// ── 부드러운 스크롤 ───────────────────────────────────────────────────
function getScrollParent(el) {
  let n = el?.parentElement;
  while (n) {
    const s = getComputedStyle(n);
    if (/(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
    n = n.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function smoothScrollToEl(el, { duration = T.scrollTo, block = "center" } = {}) {
  return new Promise((res) => {
    if (!el) return res();
    const sp = getScrollParent(el);
    const isDoc = sp === document.scrollingElement || sp === document.documentElement || sp === document.body;
    const spRect = isDoc ? { top: 0, height: window.innerHeight } : sp.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const curTop = isDoc ? (window.scrollY || document.documentElement.scrollTop || 0) : sp.scrollTop;
    let delta;
    if (block === "center") delta = elRect.top - spRect.top - (spRect.height / 2 - elRect.height / 2);
    else if (block === "start") delta = elRect.top - spRect.top - 40;
    else delta = elRect.top - spRect.top - (spRect.height - elRect.height - 40);
    const start = curTop;
    const dist = delta;
    const t0 = performance.now();
    function step(now) {
      const p = Math.min(1, (now - t0) / duration);
      const y = start + dist * easeInOutCubic(p);
      if (isDoc) window.scrollTo(0, y);
      else sp.scrollTop = y;
      if (p < 1) requestAnimationFrame(step);
      else res();
    }
    requestAnimationFrame(step);
  });
}

// 살짝 위로 되돌아갔다 다시 내려오는 "되돌아읽기" 제스처
async function rereadGesture(el) {
  const sp = getScrollParent(el);
  const isDoc = sp === document.scrollingElement || sp === document.documentElement || sp === document.body;
  const cur0 = isDoc ? window.scrollY : sp.scrollTop;
  await scrollBy(-Math.round(window.innerHeight * 0.42), 700);
  await sleep(650);
  await scrollToY(cur0, 800);
}
function scrollBy(dy, duration) {
  const el = document.scrollingElement || document.documentElement;
  return scrollToY((window.scrollY || el.scrollTop || 0) + dy, duration);
}
function scrollToY(targetY, duration) {
  return new Promise((res) => {
    const start = window.scrollY || document.documentElement.scrollTop || 0;
    const dist = targetY - start;
    const t0 = performance.now();
    function step(now) {
      const p = Math.min(1, (now - t0) / duration);
      window.scrollTo(0, start + dist * easeInOutCubic(p));
      if (p < 1) requestAnimationFrame(step);
      else res();
    }
    requestAnimationFrame(step);
  });
}

// ── 밑줄: 글자 span(.g)에 .is-underlined 를 순차로 → "그어지는" 느낌 ──
async function drawUnderline(para, from, to) {
  const gs = [...para.querySelectorAll(".g[data-char-index]")];
  if (!gs.length) return "";
  const a = Math.max(0, from);
  const b = Math.min(gs.length, to);
  for (let i = a; i < b; i++) {
    gs[i].style.setProperty("--underline-opacity", "0.85");
    gs[i].classList.add("is-underlined");
    await sleep(T.underlinePerChar);
  }
  const text = gs.slice(a, b).map((g) => g.textContent).join("");
  pushSignal({
    type: "highlight_underline",
    paragraph_id: para.dataset.paragraphId,
    selected_text: text.slice(0, 46),
    char_range: [a, b],
    duration_ms: (b - a) * T.underlinePerChar,
    draw_speed: 11,
  });
  return text;
}

// 밑줄을 잔잔한 흔적(.is-annotated)으로 가라앉힘 — 주석 확정 후
function settleToTrace(para, from, to) {
  const gs = [...para.querySelectorAll(".g[data-char-index]")];
  for (let i = Math.max(0, from); i < Math.min(gs.length, to); i++) {
    gs[i].classList.remove("is-underlined");
    gs[i].classList.add("is-annotated");
  }
}

// ── 동그라미: 실제 앱과 같은 .anchor-circle(타원, 펜으로 한 바퀴 dash) ──
// 좌표는 ink-layer 기준. 반환값으로 pullStroke 가 곡선을 이어받는다.
function drawAnchorCircle(span, para) {
  const ink = document.getElementById("ink-layer");
  if (!ink || !span) return null;
  const b = span.getBoundingClientRect();
  const host = ink.getBoundingClientRect();
  const cx = b.left + b.width / 2 - host.left;
  const cy = b.top + b.height / 2 - host.top;
  const rx = b.width / 2 + 12;
  const ry = b.height / 2 + 8;
  const h = ((rx - ry) / (rx + ry)) ** 2;
  const peri = Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const ell = document.createElementNS(SVG_NS, "ellipse");
  ell.setAttribute("class", "anchor-circle"); // 실제 앱 클래스 재사용(스타일 일치)
  ell.setAttribute("cx", cx.toFixed(1));
  ell.setAttribute("cy", cy.toFixed(1));
  ell.setAttribute("rx", rx.toFixed(1));
  ell.setAttribute("ry", ry.toFixed(1));
  ell.setAttribute("transform", `rotate(-5, ${cx.toFixed(1)}, ${cy.toFixed(1)})`);
  ell.style.strokeDasharray = peri.toFixed(1);
  ell.style.strokeDashoffset = peri.toFixed(1);
  ell.style.transition = "stroke-dashoffset 0.7s ease-out";
  ink.appendChild(ell);
  raf2(() => { ell.style.strokeDashoffset = "0"; });
  if (para) pushSignal({
    type: "circle_gesture",
    enclosed_paragraph: para.dataset.paragraphId,
    enclosed_text: (span.textContent || "표시").slice(0, 8),
    radius: Math.round(rx),
  });
  return { cx, cy, rx, ry, ell };
}

// ── "쭉 뽑기": 동그라미 가장자리에서 커서를 따라 잉크 곡선이 흘러나온다 ──
// highlight.js updateFlowingPath 와 같은 베지어. 가짜 커서 점이 같이 움직여
// "커서로 뽑는" 동작이 보인다. 끝점(toXv,toYv)은 viewport 좌표.
function pullStroke(anchor, toXv, toYv, duration = 760) {
  return new Promise((res) => {
    const ink = document.getElementById("ink-layer");
    if (!ink || !anchor) return res();
    const host = ink.getBoundingClientRect();
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "ink-stroke"); // 실제 앱 클래스 재사용
    path.style.strokeWidth = "2.6";            // 데모는 조금 더 또렷하게
    path.style.opacity = "0.95";
    ink.appendChild(path);
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      position: "fixed", width: "14px", height: "14px", borderRadius: "50%",
      background: "var(--ink, #c2410c)", zIndex: "62", pointerEvents: "none",
      transform: "translate(-50%, -50%)",
      boxShadow: "0 0 0 4px rgba(194,65,12,.18), 0 1px 6px rgba(0,0,0,.35)",
    });
    document.body.appendChild(dot);
    const { cx, cy, rx, ry } = anchor;
    const toX = toXv - host.left;
    const toY = toYv - host.top;
    const t0 = performance.now();
    function frame(now) {
      const p = Math.min(1, (now - t0) / duration);
      const e = easeOutCubic(p);
      const curX = cx + (toX - cx) * e;
      const curY = cy + (toY - cy) * e;
      const dx = curX - cx, dy = curY - cy;
      const ang = Math.atan2(dy * rx, dx * ry);
      const sx = cx + rx * Math.cos(ang), sy = cy + ry * Math.sin(ang);
      const dist = Math.hypot(dx, dy), droop = Math.min(dist * 0.12, 24);
      const c1x = sx + dx * 0.3, c1y = sy + dy * 0.3 + droop;
      const c2x = curX - dx * 0.12, c2y = curY - dy * 0.08 + droop * 0.4;
      path.setAttribute("d", `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${curX.toFixed(1)} ${curY.toFixed(1)}`);
      dot.style.left = (host.left + curX) + "px";
      dot.style.top = (host.top + curY) + "px";
      if (p < 1) requestAnimationFrame(frame);
      else { dot.remove(); res({ path }); }
    }
    requestAnimationFrame(frame);
  });
}

// ── 주석: .annotation-box 재사용 + 사람 타법 타이프라이터 ────────────
// pos = 쭉 뽑아낸 끝점(viewport). textarea 는 내용에 맞춰 자동으로 키워서 넘침 방지.
async function typewriterAnnotation(para, text, pos) {
  const box = document.createElement("div");
  box.className = "annotation-box";
  box.dataset.director = "1";
  box.style.position = "fixed";
  box.style.left = Math.min(window.innerWidth - 360, Math.max(16, pos?.x ?? 80)) + "px";
  box.style.top = Math.min(window.innerHeight - 170, pos?.y ?? 120) + "px";
  box.style.zIndex = "61";
  const ta = document.createElement("textarea");
  ta.rows = 1;
  ta.style.width = "330px";
  ta.style.resize = "none";
  ta.style.overflow = "hidden";
  box.appendChild(ta);
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "⏎ 저장";
  box.appendChild(hint);
  document.body.appendChild(box);
  const grow = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
  grow();

  const tStart = performance.now();
  ta.focus();
  for (let i = 0; i < text.length; i++) {
    ta.value += text[i];
    grow();
    let d = T.typeBase + (Math.sin(i * 12.9898) * 0.5 + 0.5) * T.typeJitter; // 결정론적 지터
    if (/[.,:?!]/.test(text[i])) d += 220;           // 구두점 뒤 한 박자
    if (text[i] === " " && i % 7 === 0) d += 160;     // 가끔 생각하는 멈춤
    await sleep(d);
  }
  await sleep(520);
  pushSignal({
    type: "highlight_annotation",
    paragraph_id: para.dataset.paragraphId,
    anchor_text: (anchor.textContent || "").slice(0, 18),
    annotation_text: text,
    underline_start_t: tStart,
    transition_t: tStart + 1200,
    textarea_appeared_t: tStart + 1400,
    confirm_t: performance.now(),
    total_duration_ms: performance.now() - tStart,
  });
  // 사고를 끌어낸 흔적 — 맵/ICAP 가 풍성해지도록 대화 신호도 살짝
  pushSignal({ type: "chat_opened", paragraph_id: para.dataset.paragraphId, reason: "annotation" });
  pushSignal({ type: "chat_turn", role: "user", len: 34, paragraph_id: para.dataset.paragraphId, reason: "annotation" });
  pushSignal({ type: "chat_turn", role: "assistant", len: 92, paragraph_id: para.dataset.paragraphId, reason: "annotation" });
  box.style.transition = "opacity 360ms ease";
  box.style.opacity = "0";
  await sleep(380);
  box.remove();
}

// ── 촛불: 대본 문구 그대로 강제 발화 ───────────────────────────────
function fireCandle(reason, line) {
  const c = window.__layer2Candle;
  if (!c) return;
  c.enable?.(true);
  // showCandle 이 dismissActive("replace") 로 이전 촛불을 알아서 교체한다.
  // 여기서 따로 dismiss() 하면 puff 중인 옛 mount 와 잠깐 겹친다 → 호출 안 함.
  c.fire?.(reason, line);
}

// 연출이 그린 ink-layer 요소(동그라미·뽑기 곡선)를 지운다. 스크롤·보드 전환 후엔
// 좌표가 어긋나 떠다니므로 맵/보드로 넘어가기 전에 정리. 밑줄·주석(인라인 클래스)은
// 텍스트와 함께 움직이므로 그대로 둔다.
function clearInk() {
  document.getElementById("ink-layer")
    ?.querySelectorAll(".anchor-circle, .ink-stroke")
    .forEach((el) => el.remove());
}

// ── 멘탈맵 / 보드 ──────────────────────────────────────────────────
function openMap() {
  const menu = document.getElementById("menu-records");
  const dash = document.getElementById("dashboard");
  // menu-records 클릭이 toggleDash 안에서 render() 를 한 번 부른다.
  // 여기서 또 render() 하면 이중 렌더로 노드가 깜빡·재배치된다 → 한 번만.
  if (dash && !dash.classList.contains("as-flyout")) menu?.click();
}
function setLayout(mode) {
  document.querySelector(`#view-toggle button[data-mode="${mode}"]`)?.click();
}

// ── 배경 흔적 시드 (멘탈맵이 별자리처럼 보이게) ──────────────────────
function seedBackground() {
  try {
    window.__layer2Candle?.enable?.(false); // 배경 신호로 촛불 오발 방지
    window.__layer2Demo?.seedRich?.();
    if (!(window.__layer2Sessions?.load?.() || []).length) window.__layer2Demo?.seedSessions?.();
  } catch { /* best-effort */ }
}

// 무조건 표면장력 글을 로드한다(샘플이 이미 떠 있어도 교체) — 대본이 표면장력 기준.
async function loadArticle() {
  try { window.__loadSurfaceTension?.(); } catch { /* ignore */ }
  for (let i = 0; i < 50 && !paras().length; i++) await sleep(80);
  await sleep(200); // 폰트/레이아웃 안정화
}
async function ensureLoaded() {
  if (paras().length) return;
  await loadArticle();
}

// 깨끗한 무대: 소스 드로어 닫고(기본 열림), 대시보드 플라이아웃 닫기
function clearStage() {
  document.body.classList.remove("drawer-open");
  document.getElementById("dashboard")?.classList.remove("as-flyout");
}

// attention 의 idle/away 블러를 막아둔다 — 프로그램 스크롤은 window scroll 을
// 안 울려서 "비활성"으로 오인되기 때문. 주기적으로 깨워준다.
function startKeepAwake() {
  stopKeepAwake();
  awakeTimer = setInterval(() => { try { wakeReading(); } catch { /* ignore */ } }, 1400);
}
function stopKeepAwake() { if (awakeTimer) { clearInterval(awakeTimer); awakeTimer = null; } }

// ── 비트 시퀀스 (15일-script.md 데모 흐름) ──────────────────────────
function buildBeats() {
  const ps = paras();
  const n = ps.length;
  pick = {
    drift: Math.min(2, n - 1),
    underline: Math.min(3, n - 1),
    circle: Math.min(5, n - 1),
    annotate: Math.min(1, n - 1),
    molecular: Math.min(2, n - 1),
  };
  beats = [
    {
      label: "글 불러오기 — 표면장력",
      run: async () => { await ensureLoaded(); await smoothScrollToEl(paras()[0], { block: "start", duration: 700 }); },
    },
    {
      label: "평소처럼 읽기 — 드리프트 + 밑줄·동그라미",
      run: async () => {
        await smoothScrollToEl(paras()[pick.drift], { duration: T.scrollDrift, block: "center" });
        const u = paras()[pick.underline];
        await smoothScrollToEl(u, { duration: 800 });
        await drawUnderline(u, 0, 22);
        await sleep(350);
        const cg = [...paras()[pick.circle].querySelectorAll(".g[data-char-index]")];
        drawAnchorCircle(cg[Math.min(6, cg.length - 1)], paras()[pick.circle]);
        pushSignal({ type: "dwell", paragraph_id: u.dataset.paragraphId, duration_ms: 6000, visible_frac: 0.9, enter_count: 1, total_ms: 6000 });
      },
    },
    {
      label: "주석 — 동그라미 → 쭉 뽑기 → 타이핑",
      run: async () => {
        const a = paras()[pick.annotate];
        await smoothScrollToEl(a, { duration: 800, block: "start" });
        await drawUnderline(a, 4, 24);
        // 밑줄 끝 단어에 동그라미 → 커서로 쭉 뽑아냄 → 그 끝에 주석창
        const gs = [...a.querySelectorAll(".g[data-char-index]")];
        const anchor = drawAnchorCircle(gs[Math.min(22, gs.length - 1)], a);
        await sleep(720); // 동그라미가 한 바퀴 그려질 동안
        const ink = document.getElementById("ink-layer").getBoundingClientRect();
        const toX = Math.min(window.innerWidth - 370, ink.left + (anchor?.cx ?? 200) + 160);
        const toY = Math.min(window.innerHeight - 190, ink.top + (anchor?.cy ?? 200) + 110);
        await pullStroke(anchor, toX, toY, 1100); // 천천히 "쭉" 뽑기
        await sleep(260);                          // 다 뽑은 곡선을 한 박자 보여줌
        await typewriterAnnotation(a, ANNOTATION_TEXT, { x: toX, y: toY });
        settleToTrace(a, 4, 24);
      },
    },
    {
      label: "머물고 되돌아가기 (분자 설명 문단)",
      run: async () => {
        const m = paras()[pick.molecular];
        await smoothScrollToEl(m, { duration: 900 });
        await sleep(900);
        await rereadGesture(m);
        pushSignal({ type: "dwell", paragraph_id: m.dataset.paragraphId, duration_ms: 9800, visible_frac: 0.85, enter_count: 3, total_ms: 9800 });
        pushSignal({ type: "reread", paragraph_id: m.dataset.paragraphId, visit_count: 2, enter_count: 2, reverse_rate: 0.5, scroll_top: 600 });
        pushSignal({ type: "reread", paragraph_id: m.dataset.paragraphId, visit_count: 3, enter_count: 3, reverse_rate: 0.67, scroll_top: 820 });
      },
    },
    {
      label: "흔적이 단락·글자 단위로 쌓임 (잔잔)",
      run: async () => { await sleep(500); },
    },
    {
      label: "촛불 ① — 주석 직후 (annotation_seam)",
      run: async () => {
        await smoothScrollToEl(paras()[pick.annotate], { duration: 800 });
        await sleep(250);
        fireCandle("annotation", CANDLE_LINE_1);
      },
    },
    {
      label: "촛불 ② — 여러 번 오감 → 개념 지도 (isolation)",
      run: async () => {
        await smoothScrollToEl(paras()[pick.molecular], { duration: 800 });
        await sleep(250);
        fireCandle("isolation", CANDLE_LINE_2);
      },
    },
    {
      label: "Mental Model Map 펼침",
      run: async () => { window.__layer2Candle?.dismiss?.(); clearInk(); await sleep(300); openMap(); },
    },
    {
      label: "이해 점검 대화 (보조)",
      run: async () => { await sleep(600); },
    },
    {
      label: "보드로 전환 — 읽기 후 흔적 전개",
      run: async () => {
        const dash = document.getElementById("dashboard");
        if (dash?.classList.contains("as-flyout")) document.getElementById("menu-records")?.click();
        clearInk();
        await sleep(300);
        setLayout("board");
        await sleep(500);
      },
    },
    {
      label: "단락별 밀도 — 마무리",
      run: async () => { await smoothScrollToEl(paras()[Math.min(4, paras().length - 1)], { duration: 1600, block: "center" }); },
    },
  ];
}

// ── 연출 HUD (발표자용; 녹화 프레임 밖으로 빼거나 'h'로 토글) ─────────
function buildHud(show) {
  removeHud();
  if (!show) return;
  const el = document.createElement("div");
  el.id = "director-hud";
  Object.assign(el.style, {
    position: "fixed", left: "14px", bottom: "14px", zIndex: "9999",
    font: "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "#fff", background: "rgba(17,17,20,.86)", border: "1px solid rgba(255,255,255,.16)",
    borderRadius: "10px", padding: "10px 12px", maxWidth: "320px", pointerEvents: "none",
    boxShadow: "0 6px 24px rgba(0,0,0,.35)", backdropFilter: "blur(6px)",
  });
  hudEl = el;
  document.body.appendChild(el);
  paintHud();
}
function removeHud() { hudEl?.remove(); hudEl = null; }
function paintHud() {
  if (!hudEl) return;
  const total = beats.length;
  const now = cur >= 0 && cur < total ? beats[cur].label : "준비됨";
  const next = cur + 1 < total ? beats[cur + 1].label : "끝";
  hudEl.innerHTML =
    `<div style="opacity:.6;letter-spacing:.04em">🎬 DIRECTOR · ${Math.max(0, cur) + (cur < 0 ? 0 : 1)}/${total}</div>` +
    `<div style="margin-top:4px;font-weight:600">${cur < 0 ? "▶ Space 로 시작" : now}</div>` +
    `<div style="margin-top:3px;opacity:.7">다음 ▸ ${next}</div>` +
    `<div style="margin-top:6px;opacity:.45">Space/→ 다음 · R 처음 · H 숨김 · Esc 종료</div>`;
}

// ── 진행 제어 ──────────────────────────────────────────────────────
async function next() {
  if (running) return;
  if (cur + 1 >= beats.length) { paintHud(); return; }
  running = true;
  cur += 1;
  paintHud();
  try { await beats[cur].run(); }
  catch (e) { console.warn("[director] beat error", cur, e); }
  finally { running = false; paintHud(); }
}

async function runAuto() {
  while (cur + 1 < beats.length) {
    await next();
    await sleep(T.autoGap);
  }
}

function reset() {
  try { window.location.reload(); } catch { /* ignore */ }
}

function onKey(e) {
  if (!armed) return;
  const k = e.key;
  if (k === " " || k === "ArrowRight" || k === "ArrowDown" || k === "Enter") {
    e.preventDefault(); next();
  } else if (k === "r" || k === "R") {
    e.preventDefault(); reset();
  } else if (k === "h" || k === "H") {
    e.preventDefault(); if (hudEl) removeHud(); else buildHud(true);
  } else if (k === "Escape") {
    e.preventDefault(); armed = false; removeHud(); stopKeepAwake();
  }
}

export function initDirector(opts = {}) {
  readerEl = opts.readerEl || document.getElementById("reader");
  window.__layer2Director = {
    async start(o = {}) {
      const { auto = false, hud = true } = o;
      await loadArticle();
      clearStage();
      startKeepAwake();
      buildBeats();
      seedBackground();
      cur = -1;
      armed = true;
      buildHud(hud);
      window.addEventListener("keydown", onKey, { capture: true });
      if (auto) { await runAuto(); stopKeepAwake(); }
      return true;
    },
    next, reset,
    auto: () => runAuto(),
    goto: async (i) => { cur = Math.max(-1, i - 1); await next(); },
    state: () => ({ cur, total: beats.length, armed, running, label: beats[cur]?.label }),
  };
  // #director 해시로 들어오면 자동 준비(STEP)
  if (String(location.hash).includes("director")) {
    setTimeout(() => window.__layer2Director.start({ hud: true }), 400);
  }
}
