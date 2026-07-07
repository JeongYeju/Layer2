import { test } from "@playwright/test";

// 히어로 목업용: 아이패드 가로 화면에 끼울 "진짜 Layer 2 리더" 스샷.
//   실행:  CI=1 npx playwright test hero-ipad
//   결과:  Private/hero-explore/ui-*.png  (2732x2048, 4:3 가로 = 아이패드)
// shots.spec.js 의 흔적 연출 헬퍼를 그대로 재사용한다.

const DIR = "Private/hero-explore";
test.use({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2 });

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

test("hero ipad ui", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");
  // 발표 데모 글(표면장력: 물방울은 왜 둥근가)로 전환
  await page.evaluate(() => window.__loadSurfaceTension && window.__loadSurfaceTension());
  await page.waitForSelector(".para[data-paragraph-id]");
  await pause(page, 800);

  // 크롬(상단바·사이드바·양옆 rail·접기 핸들) 전부 숨겨 본문만 깨끗하게 + 본문 크게
  await page.evaluate(() => {
    const hide = (sel) =>
      document.querySelectorAll(sel).forEach((el) => (el.style.display = "none"));
    hide(".topbar");
    hide("#sidebar");
    hide(".rail-left");
    hide(".rail-right");
    hide(".drawer-handle");
  });
  await pause(page, 600);

  // 흔적: 밑줄 · 동그라미 · 주석
  await underline(page, 1, 4, 30);
  await circle(page, 2, 8);
  await annotate(page, 3, 2, 22, "이 부분이 핵심 : 앞 단락이랑 이렇게 연결되는구나.");
  await page.locator(".para[data-paragraph-id]").nth(1).scrollIntoViewIfNeeded();
  await pause(page, 500);

  // A) 흔적만 (깨끗한 읽기 상태)
  await page.screenshot({ path: `${DIR}/ui-clean-reading.png` });

  // B) 촛불 개입
  await page.evaluate(() => {
    document.querySelectorAll(".candle-mount").forEach((c) => c.remove());
    window.__layer2Candle &&
      window.__layer2Candle.fire(
        "isolation",
        "이 부분 자꾸 되돌아오네. '표면장력'이 어떤 건지 다시 짚어줄까?",
      );
  });
  const candle = page.locator(".candle-mount:not(.is-puff)").last();
  await candle.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await pause(page, 1200);
  await page.screenshot({ path: `${DIR}/ui-clean-candle.png` });

  // C) 보드 모드 — 흔적 카드 전개
  await page.evaluate(() => {
    const b = document.querySelector('#view-toggle button[data-mode="board"]');
    if (b) b.click();
  });
  await pause(page, 1600);
  await page.screenshot({ path: `${DIR}/ui-clean-board.png` });
});
