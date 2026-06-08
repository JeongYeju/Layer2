import { test, expect } from "@playwright/test";

// 내재화 B v1.1 — 보드(시맨틱뷰)에서 회상 카드(cloze) 토글 시각 검증.
// 로컬에서 실제 창 보며: `npm run test:headed`
// 밑줄 친 단락의 board-card 에 "🧠 회상" → 그 단락 밑줄을 인플레이스 cloze 로.

test("보드 회상: 밑줄 단락 → 🧠회상 → cloze 빈칸 → 정답/자가평가", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");

  // 더미 읽기 신호(밑줄 포함) 시드 → 회상 재료 생성
  await page.evaluate(() => window.__layer2Demo.seed());

  // 보드 모드 진입
  await page.click('#view-toggle button[data-mode="board"]');

  // 밑줄 있는 단락 카드에 회상 버튼이 떠야 한다
  const btn = page.locator(".board-recall-btn").first();
  await expect(btn).toBeVisible();
  await page.screenshot({ path: "test-results/board-recall-btn.png", fullPage: true });

  // 클릭 → cloze 빈칸
  await btn.click();
  const cloze = page.locator(".board-cloze").first();
  await expect(cloze).toBeVisible();
  await expect(page.locator(".recall-blank").first()).toBeVisible();
  await page.screenshot({ path: "test-results/board-recall-cloze.png" });

  // 정답 보기 → 자가평가
  await cloze.locator(".board-cloze-show").click();
  await expect(cloze.locator(".board-cloze-ans")).toBeVisible();
  await cloze.locator('.board-cloze-rate-btn[data-r="1"]').click();
  await expect(cloze.locator(".board-cloze-rate")).toContainText("인출 성공");
  await page.screenshot({ path: "test-results/board-recall-revealed.png" });
});

test("보드 회상: 버튼 다시 누르면 접힘 (토글)", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");
  await page.evaluate(() => window.__layer2Demo.seed());
  await page.click('#view-toggle button[data-mode="board"]');

  const btn = page.locator(".board-recall-btn").first();
  await btn.click();
  await expect(page.locator(".board-recall-zone").first()).toBeVisible();
  await btn.click();
  await expect(page.locator(".board-recall-zone")).toHaveCount(0);
});
