import { test, expect } from "@playwright/test";

// UI 진입점 정리 검증 (중복 제거 · 드로어 과잉 정리 · 독서 끝내기 노출).
//   npm run test:headed -- ui-entrypoints

test("대시보드 진입점은 헤더 '기록' 하나, 레일 중복(#btn-records)은 제거됨", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");

  // 중복/오인 진입점은 더 이상 없어야 한다
  await expect(page.locator("#btn-records")).toHaveCount(0);
  await expect(page.locator("#open-sources")).toHaveCount(0);

  // 헤더 '기록'이 대시보드 플라이아웃을 연다 (단일 진입점)
  const dash = page.locator("#dashboard");
  await expect(dash).not.toHaveClass(/as-flyout/);
  await page.click("#menu-records");
  await expect(dash).toHaveClass(/as-flyout/);
});

test("헤더 '독서 끝내기'(#btn-finish) → 세션 종료 → 이해 점검 대화 런처 노출", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");
  // 조금 읽은 흔적
  await page.evaluate(() => window.__layer2Demo.seed());

  const finish = page.locator("#btn-finish");
  await expect(finish).toBeVisible();
  await finish.click();

  // session_end → chat.js 가 복습(이해 점검) 런처를 띄운다
  await expect(page.locator(".review-launcher")).toBeVisible({ timeout: 3000 });
});
