import { test, expect } from "@playwright/test";

// 내재화 B v1 — 회상 워크시트 시각 검증.
// 로컬에서 실제 창 보며: `npm run test:headed`
// (브라우저 없으면 먼저: `npx playwright install chromium`)

test("회상 워크시트: 밑줄 → cloze 카드 → 풀이/공개", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");

  // 더미 읽기 신호(밑줄 포함) 시드 → 회상 카드 재료 생성
  await page.evaluate(() => window.__layer2Demo.seed());

  // 대시보드(기록) 플라이아웃 열기 → 워크시트 생성
  await page.click("#menu-records");
  await page.click("#recall-gen");

  // 카드 + 빈칸이 떠야 한다 (cued recall)
  const card = page.locator(".recall-card").first();
  await expect(card).toBeVisible();
  await expect(page.locator(".recall-blank").first()).toBeVisible();
  await page.screenshot({ path: "test-results/recall-worksheet.png", fullPage: true });

  // 풀이 → 확인 → 정답 공개 → self-rate
  await card.locator(".recall-input").fill("내가 떠올린 답");
  await card.locator(".recall-check").click();
  await expect(card.locator(".recall-answer")).toBeVisible();
  await card.locator(".recall-yes").click();
  await expect(card.locator(".recall-good")).toBeVisible();
  await page.screenshot({ path: "test-results/recall-revealed.png" });
});

test('회상 워크시트: "더 어렵게" = 문맥 가린 자유 회상', async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");
  await page.evaluate(() => window.__layer2Demo.seed());

  await page.click("#menu-records");
  await page.check("#recall-hard");
  await page.click("#recall-gen");

  await expect(page.locator(".recall-free").first()).toBeVisible();
  await expect(page.locator(".recall-blank")).toHaveCount(0); // 자유 회상엔 빈칸 없음
  await page.screenshot({ path: "test-results/recall-hard.png", fullPage: true });
});
