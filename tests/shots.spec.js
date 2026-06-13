import { test, expect } from "@playwright/test";

// 발표/슬라이드용 정지 스크린샷 세트. headless(창 안 뜸) + 고해상도(2x).
// page.screenshot 은 렌더 버퍼를 떠서 다른 창에 가려져도 깨끗하다.
//   GEMINI_API_KEY=... (.env.local) 있으면 멘탈맵이 "의미 엣지(임베딩)"로 풍성.
//   실행:  npx playwright test shots
//   결과:  docs/presentation/shots/*.png

const KEY = process.env.GEMINI_API_KEY || "";
const DIR = "docs/presentation/shots";
test.use({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 });

const pause = (p, ms) => p.waitForTimeout(ms);

async function underline(page, idx, a, b) {
  const para = page.locator(".para[data-paragraph-id]").nth(idx);
  await para.scrollIntoViewIfNeeded();
  await pause(page, 300);
  const spans = para.locator("[data-char-index]");
  const n = await spans.count();
  if (n < 4) return;
  const s = await spans.nth(Math.min(a, n - 2)).boundingBox();
  const e = await spans.nth(Math.min(b, n - 1)).boundingBox();
  if (!s || !e) return;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    const t = i / 20;
    await page.mouse.move(s.x + (e.x - s.x) * t + s.width / 2, s.y + (e.y - s.y) * t + s.height / 2);
    await pause(page, 24);
  }
  await page.mouse.up();
  await pause(page, 450);
}

async function circle(page, idx, ci) {
  const para = page.locator(".para[data-paragraph-id]").nth(idx);
  await para.scrollIntoViewIfNeeded();
  await pause(page, 300);
  const spans = para.locator("[data-char-index]");
  const n = await spans.count();
  if (!n) return;
  const box = await spans.nth(Math.min(ci, n - 1)).boundingBox();
  if (!box) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const R = 40;
  const pts = 46;
  await page.mouse.move(cx + R, cy);
  for (let i = 1; i <= pts; i++) {
    const ang = (i / pts) * (Math.PI * 2 * 1.08);
    await page.mouse.move(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R * 0.78);
    await pause(page, 26);
  }
  await pause(page, 500);
}

async function annotate(page, idx, a, b, text) {
  const para = page.locator(".para[data-paragraph-id]").nth(idx);
  await para.scrollIntoViewIfNeeded();
  await pause(page, 300);
  const pbox = await para.boundingBox();
  const spans = para.locator("[data-char-index]");
  const n = await spans.count();
  if (n < 4 || !pbox) return;
  const s = await spans.nth(Math.min(a, n - 2)).boundingBox();
  const e = await spans.nth(Math.min(b, n - 1)).boundingBox();
  if (!s || !e) return;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    await page.mouse.move(s.x + (e.x - s.x) * t + s.width / 2, s.y + (e.y - s.y) * t + s.height / 2);
    await pause(page, 24);
  }
  const ex = e.x + e.width / 2;
  const ey = pbox.y + pbox.height + 28;
  await page.mouse.move(ex, ey, { steps: 10 });
  await pause(page, 250);
  await page.mouse.move(ex + 2, ey + 2);
  await pause(page, 900);
  const ta = page.locator(".annotation-box textarea");
  if (!(await ta.count())) {
    await page.mouse.up();
    return;
  }
  await ta.click();
  await ta.type(text, { delay: 28 });
  await pause(page, 400);
  await ta.press("Enter");
  await pause(page, 600);
  await page.mouse.up();
}

test("발표용 스크린샷 세트", async ({ page }) => {
  test.setTimeout(180000);
  await page.addInitScript((k) => {
    if (k) {
      localStorage.setItem("layer2.llm.provider", "gemini");
      localStorage.setItem("layer2.llm.key", k);
    }
  }, KEY);
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");
  await pause(page, 800);

  // 1) 읽기 화면 (실제 흔적: 밑줄·동그라미·주석)
  await underline(page, 1, 4, 30);
  await circle(page, 2, 8);
  await annotate(page, 3, 2, 22, "이 부분이 핵심 : 앞 단락이랑 이렇게 연결되는구나.");
  await page.locator(".para[data-paragraph-id]").nth(1).scrollIntoViewIfNeeded();
  await pause(page, 600);
  await page.screenshot({ path: `${DIR}/01-reading.png` });

  // 2) 풍성한 시드 (맵/보드 별자리용)
  await page.evaluate(() => window.__layer2Demo.seedRich());
  await pause(page, 700);

  // 3) 촛불 개입
  await page.evaluate(() => {
    document.querySelectorAll(".candle-mount").forEach((c) => c.remove());
    window.__layer2Candle && window.__layer2Candle.fire("annotation");
  });
  const candle = page.locator(".candle-mount:not(.is-puff)").last();
  await candle.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await pause(page, 1200);
  await page.screenshot({ path: `${DIR}/02-candle.png` });

  // 4) 티키타카 (실제 Gemini 응답)
  const chatBtn = candle.locator(".candle-chat-btn");
  if (await chatBtn.count().catch(() => 0)) {
    await chatBtn.click().catch(() => {});
    await page.locator("#chat-panel").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    await pause(page, 800);
    const input = page.locator("#chat-input");
    if (await input.count()) {
      const asst = page.locator(".chat-msg--assistant:not(.chat-typing)");
      const before = await asst.count(); // 오프닝 멘트 수
      await input.click();
      await input.type("이 개념이 왜 중요한지 잘 모르겠어요.", { delay: 22 });
      await page.locator("#chat-send").click().catch(() => {});
      if (KEY) {
        // 새 어시스턴트 답(=before+1)이 실제로 늘어날 때까지 대기
        await expect
          .poll(() => asst.count(), { timeout: 25000 })
          .toBeGreaterThan(before)
          .catch(() => {});
        await pause(page, 1500);
      } else {
        await pause(page, 1800);
      }
    }
    await page.screenshot({ path: `${DIR}/03-tikitaka.png` });
    await page.locator("#chat-close").click().catch(() => {});
    await pause(page, 500);
  }

  // 5) 보드 모드 (시맨틱 흔적 카드)
  await page.click('#view-toggle button[data-mode="board"]');
  await pause(page, 1500);
  await page.screenshot({ path: `${DIR}/04-board.png`, fullPage: true });

  // 6) 멘탈 모델 맵 (별자리, 의미 엣지) — 기록 패널
  await page.click('#view-toggle button[data-mode="scroll"]');
  await pause(page, 400);
  await page.click("#menu-records");
  await page.locator("#m-microreport .rp-spine").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (KEY) {
    await expect
      .poll(() => page.locator("#m-microreport .rp-edges-legend").textContent().catch(() => ""), {
        timeout: 18000,
      })
      .toContain("임베딩")
      .catch(() => {});
  }
  await pause(page, 1200);
  await page.screenshot({ path: `${DIR}/05-mentalmap-full.png` });
  await page.locator("#dashboard").screenshot({ path: `${DIR}/05-mentalmap-panel.png` }).catch(() => {});

  const edges = await page.locator("#m-microreport .rp-edge").count();
  const legend = await page.locator("#m-microreport .rp-edges-legend").textContent().catch(() => "");
  const nodes = await page.locator("#m-microreport .rp-node").count();
  console.log(`[shots] nodes=${nodes} edges=${edges} legend="${legend}"`);
});
