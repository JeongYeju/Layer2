import { test, expect } from "@playwright/test";

// 엔드투엔드 데모 — 헤드풀(실제 창) + 비디오 녹화 + (선택) 실제 Gemini.
//
//   npm run test:live          # = playwright test demo-e2e --headed
//
// 실제 사람이 쓰듯 글을 위에서 아래까지 정독하고(위아래 스크롤), 세 가지 흔적을
// 전부 남긴다 — ① 그냥 밑줄 ② 커서로 단어 동그라미(circle 제스처) ③ 밑줄+주석.
// 그다음 촛불→티키타카(키 있으면 진짜 Gemini 왕복), 보드(시맨틱) 좌우 패닝,
// 회상(cloze)·내 말 요약, 대시보드까지 한 바퀴. 전 과정이 .webm 으로 남는다.
//
// API 키: 채팅창/코드에 넣지 말 것. 레포 루트에 `.env.local` 을 만들고
//   GEMINI_API_KEY=...
//   GEMINI_MODEL=gemini-2.5-flash   (선택)
// 를 넣으면 playwright.config.js 가 읽어 process.env 로 넘기고, 아래
// addInitScript 가 브라우저 localStorage(layer2.llm.*)에 주입한다.
// 키가 없으면 정적 폴백으로도 전 구간이 끝까지 돈다(데모 안 깨짐).

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const LIVE = !!GEMINI_KEY;

test.use({ video: "on", viewport: { width: 1440, height: 900 } });

const pause = (page, ms) => page.waitForTimeout(ms);

// ── 흔적 제스처 헬퍼 ─────────────────────────────────────────

// 한 단락 안에서 char span 을 가로질러 드래그 → "그냥 밑줄"(mouseup 으로 끝).
async function realUnderline(page, paraIdx, fromChar, toChar) {
  const para = page.locator(".para[data-paragraph-id]").nth(paraIdx);
  await para.scrollIntoViewIfNeeded();
  await pause(page, 400);
  const spans = para.locator("[data-char-index]");
  const n = await spans.count();
  if (n < 4) return false;
  const start = await spans.nth(Math.min(fromChar, n - 2)).boundingBox();
  const end = await spans.nth(Math.min(toChar, n - 1)).boundingBox();
  if (!start || !end) return false;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(
      start.x + (end.x - start.x) * t + start.width / 2,
      start.y + (end.y - start.y) * t + start.height / 2,
    );
    await pause(page, 32);
  }
  await page.mouse.up();
  await pause(page, 600);
  return true;
}

// 버튼 안 누르고 단어 위에서 커서로 원을 그린다 → circle_gesture(단어 동그라미).
// signals.js 감지 기준: 2s 창, ≥20점, 반지름≥30, 원형도, 각도 커버리지≥300°.
async function realCircle(page, paraIdx, charIdx) {
  const para = page.locator(".para[data-paragraph-id]").nth(paraIdx);
  await para.scrollIntoViewIfNeeded();
  await pause(page, 400);
  const spans = para.locator("[data-char-index]");
  const n = await spans.count();
  if (!n) return false;
  const box = await spans.nth(Math.min(charIdx, n - 1)).boundingBox();
  if (!box) return false;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const R = 40;
  const pts = 46; // ≥20점
  // 살짝 한 바퀴 넘게(=390°) 돌아 커버리지 여유. 세로를 조금 눌러 글줄 타원에 맞춤.
  await page.mouse.move(cx + R, cy);
  for (let i = 1; i <= pts; i++) {
    const a = (i / pts) * (Math.PI * 2 * 1.08);
    await page.mouse.move(cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.78);
    await pause(page, 30); // 46*30 ≈ 1.38s < 2s 창
  }
  await pause(page, 700);
  return true;
}

// 밑줄 → 단락 아래로 커서 이탈(transition) → 텍스트박스에 주석 입력 → Enter.
async function realAnnotation(page, paraIdx, fromChar, toChar, text) {
  const para = page.locator(".para[data-paragraph-id]").nth(paraIdx);
  await para.scrollIntoViewIfNeeded();
  await pause(page, 400);
  const pbox = await para.boundingBox();
  const spans = para.locator("[data-char-index]");
  const n = await spans.count();
  if (n < 4 || !pbox) return false;
  const start = await spans.nth(Math.min(fromChar, n - 2)).boundingBox();
  const end = await spans.nth(Math.min(toChar, n - 1)).boundingBox();
  if (!start || !end) return false;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  const steps = 18;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(
      start.x + (end.x - start.x) * t + start.width / 2,
      start.y + (end.y - start.y) * t + start.height / 2,
    );
    await pause(page, 30);
  }
  const exitX = end.x + end.width / 2;
  const exitY = pbox.y + pbox.height + 28;
  await page.mouse.move(exitX, exitY, { steps: 10 });
  await pause(page, 250);
  await page.mouse.move(exitX + 2, exitY + 2);
  await pause(page, 900); // >600ms → 텍스트박스
  const ta = page.locator(".annotation-box textarea");
  if (!(await ta.count())) {
    await page.mouse.up();
    return false;
  }
  await ta.click();
  await ta.type(text, { delay: 50 });
  await pause(page, 500);
  await ta.press("Enter");
  await pause(page, 700);
  await page.mouse.up();
  return true;
}

// 부드러운 휠 스크롤(여러 번 나눠서 사람처럼).
async function wheel(page, dx, dy, times = 6, gap = 90) {
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(dx, dy);
    await pause(page, gap);
  }
}

test("E2E 라이브 데모: 정독→밑줄·동그라미·주석→촛불·티키타카→보드 패닝→회상·요약→대시보드", async ({
  page,
}) => {
  test.setTimeout(300000);

  // 앱 로드 전에 LLM 자격을 localStorage 에 주입(키는 .env.local 에서만 옴).
  await page.addInitScript(
    ([key, model]) => {
      if (key) {
        localStorage.setItem("layer2.llm.provider", "gemini");
        localStorage.setItem("layer2.llm.key", key);
        localStorage.setItem("layer2.llm.model", model);
      }
    },
    [GEMINI_KEY, GEMINI_MODEL],
  );

  console.log(
    LIVE
      ? `[demo] LIVE 모드 — Gemini(${GEMINI_MODEL}) 실제 호출`
      : "[demo] 폴백 모드 — 키 없음(.env.local 에 GEMINI_API_KEY 넣으면 실제 대화)",
  );

  // ── 0. 진입 ──────────────────────────────────────────────
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");
  await pause(page, 1200);
  const paraCount = await page.locator(".para[data-paragraph-id]").count();

  // ── 1. 위에서 아래까지 정독(스크롤) — dwell 신호가 쌓인다 ──
  for (let i = 0; i < paraCount; i++) {
    await page.locator(".para[data-paragraph-id]").nth(i).scrollIntoViewIfNeeded();
    // 무거운 단락은 더 오래 머문다(사람처럼)
    await pause(page, i % 3 === 0 ? 1100 : 750);
  }
  await pause(page, 600);
  // 한 번 되감아 올라가며(역방향) 다시 본다 — reread/reverse 신호
  await wheel(page, 0, -360, 8, 110);
  await pause(page, 800);

  // ── 2. 그냥 밑줄 ─────────────────────────────────────────
  if (await realUnderline(page, 1, 4, 26)) {
    await page.screenshot({ path: "test-results/e2e-1-underline.png" });
  }
  await pause(page, 600);

  // ── 3. 커서로 단어 동그라미(circle 제스처) ───────────────
  if (await realCircle(page, 1, 8)) {
    await page.screenshot({ path: "test-results/e2e-2-circle.png" });
  }
  await pause(page, 600);

  // ── 4. 밑줄 + 주석 ───────────────────────────────────────
  const annotated = await realAnnotation(
    page,
    2,
    2,
    22,
    "여기가 핵심 — 앞 단락의 주장과 이렇게 이어지는구나.",
  );
  if (annotated) {
    await page
      .locator(".is-annotated, .anno-marker")
      .first()
      .waitFor({ state: "visible", timeout: 3000 })
      .catch(() => {});
    await page.screenshot({ path: "test-results/e2e-3-annotation.png" });
  }
  await pause(page, 700);

  // 아래쪽 단락에도 흔적을 더 남기며 끝까지 한 번 더 내려간다
  await realUnderline(page, Math.min(4, paraCount - 1), 2, 20);
  await realCircle(page, Math.min(5, paraCount - 1), 6);
  await pause(page, 500);
  // 위로 되돌아오며 남긴 흔적을 훑는다
  await wheel(page, 0, -500, 8, 110);
  await page.locator(".para[data-paragraph-id]").first().scrollIntoViewIfNeeded();
  await pause(page, 900);

  // ── 5. 보드/대시보드용 신호 보강 + 촛불 ──────────────────
  await page.evaluate(() => window.__layer2Demo && window.__layer2Demo.seed());
  await pause(page, 800);
  await page.evaluate(() => {
    document.querySelectorAll(".candle-mount").forEach((c) => c.remove());
    window.__layer2Candle && window.__layer2Candle.fire("annotation");
  });
  const candle = page.locator(".candle-mount:not(.is-puff)").last();
  await candle.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await pause(page, 1400);
  await page.screenshot({ path: "test-results/e2e-4-candle.png" });

  // ── 6. 촛불 → 티키타카(키 있으면 진짜 Gemini 왕복) ────────
  const chatBtn = candle.locator(".candle-chat-btn");
  if (await chatBtn.count().catch(() => 0)) {
    await chatBtn.click().catch(() => {});
    await page.locator("#chat-panel").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    await pause(page, 1200);
    const input = page.locator("#chat-input");
    const askTurns = [
      "이 부분이 왜 중요한지 잘 모르겠어요.",
      "그럼 앞 단락이랑은 어떻게 연결돼요?",
    ];
    for (const q of askTurns) {
      if (!(await input.count())) break;
      await input.click();
      await input.type(q, { delay: 45 });
      await pause(page, 400);
      await page.locator("#chat-send").click().catch(() => {});
      if (LIVE) {
        // 실제 응답(.chat-msg--assistant 중 typing 아닌 것)이 늘어날 때까지 대기
        await page
          .locator(".chat-msg--assistant:not(.chat-typing)")
          .last()
          .waitFor({ state: "visible", timeout: 20000 })
          .catch(() => {});
        await pause(page, 1500);
      } else {
        await pause(page, 2200);
      }
    }
    await page.screenshot({ path: "test-results/e2e-5-tikitaka.png" });
    const close = page.locator("#chat-close");
    if (await close.count()) {
      await close.click().catch(() => {});
      await pause(page, 600);
    }
  }

  // ── 7. 보드(시맨틱 뷰) — 좌우로 펼쳐보기 ─────────────────
  await page.click('#view-toggle button[data-mode="board"]');
  await pause(page, 1500);
  await page.screenshot({ path: "test-results/e2e-6-board.png", fullPage: true });
  // 가운데에 커서 두고 좌우 패닝 + 카드 따라 위아래로
  const vw = 1440, vh = 900;
  await page.mouse.move(vw / 2, vh / 2);
  await wheel(page, 500, 0, 6, 120); // 오른쪽으로 펼치기(흔적 카드 쪽)
  await pause(page, 800);
  await page.screenshot({ path: "test-results/e2e-7-board-pan-right.png", fullPage: true });
  await wheel(page, 0, 380, 6, 120); // 카드 따라 아래로
  await pause(page, 700);
  await wheel(page, -500, 0, 6, 120); // 왼쪽(원문)으로 되돌리기
  await wheel(page, 0, -380, 5, 120); // 위로
  await pause(page, 800);

  // ── 8. 보드 회상(cloze) ──────────────────────────────────
  const recallBtn = page.locator(".board-recall-btn").first();
  if (await recallBtn.count()) {
    await recallBtn.scrollIntoViewIfNeeded();
    await pause(page, 500);
    await recallBtn.click();
    const cloze = page.locator(".board-cloze").first();
    await cloze.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
    await pause(page, 1400);
    await page.screenshot({ path: "test-results/e2e-8-recall.png" });
    const show = cloze.locator(".board-cloze-show");
    if (await show.count()) {
      await show.click();
      await pause(page, 900);
      const rate = cloze.locator('.board-cloze-rate-btn[data-r="1"]');
      if (await rate.count()) {
        await rate.click();
        await pause(page, 700);
      }
    }
  }

  // ── 9. 보드 "내 말 요약"(키 있으면 진짜 Gemini 초안) ─────
  const summary = page.locator(".board-summary");
  if (await summary.count()) {
    await summary.scrollIntoViewIfNeeded();
    await pause(page, 500);
    const gen = summary.locator(".board-summary-gen");
    if (await gen.count()) {
      await gen.click();
      // 진짜 초안 생성은 시간이 걸린다 — textarea 가 채워질 때까지
      const ta = summary.locator(".board-summary-text");
      await expect(ta).not.toHaveValue("", { timeout: LIVE ? 20000 : 6000 }).catch(() => {});
      await pause(page, 1500);
      await page.screenshot({ path: "test-results/e2e-9-summary.png", fullPage: true });
    }
  }

  // ── 10. 대시보드 — 마찰 + 다중 세션 ──────────────────────
  await page.click('#view-toggle button[data-mode="scroll"]');
  await pause(page, 600);
  await page.evaluate(() => window.__layer2Demo && window.__layer2Demo.seedSessions(8));
  await pause(page, 400);
  const records = page.locator("#menu-records");
  if (await records.count()) {
    await records.click();
    await pause(page, 1500);
    await wheel(page, 0, 300, 4, 140); // 대시보드 내부 스크롤
    await pause(page, 800);
    await page.screenshot({ path: "test-results/e2e-10-dashboard.png", fullPage: true });
  }
  await pause(page, 1800); // 엔딩 여유
});
