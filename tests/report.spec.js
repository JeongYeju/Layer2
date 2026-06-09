import { test, expect } from "@playwright/test";

// Micro 리포트 — Mental Model Map 시각 검증.
//   npm run test:headed -- report
// 더미 신호 시드 → 기록(대시보드) 열기 → 멘탈 모델 맵에 진단·요약·척추 노드·
// "내가 구성한 개념"(주석)이 떠야 하고, 노드 클릭 시 해당 단락으로 스크롤.

test("멘탈 모델 맵: 진단 + 요약 + 척추 노드 + 구성한 개념", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");

  // 더미 독서 신호(밑줄·주석·동그라미·대화 포함)
  await page.evaluate(() => window.__layer2Demo.seed());

  // 기록 패널(대시보드) 열기
  await page.click("#menu-records");
  const report = page.locator("#m-microreport");
  await expect(report).toBeVisible();

  // 한 줄 진단 + 요약 통계 칩
  await expect(report.locator(".rp-verdict")).toBeVisible();
  await expect(report.locator(".rp-stat").first()).toBeVisible();

  // 척추 노드가 하나 이상
  await expect(report.locator(".rp-node").first()).toBeVisible();
  await page.screenshot({ path: "test-results/report-map.png", fullPage: true });

  // 주석이 있으니 "내가 구성한 개념" 섹션
  await expect(report.locator(".rp-concepts")).toBeVisible();
  const concept = report.locator(".rp-concept").first();
  await expect(concept).toBeVisible();

  // 노드 클릭 → 해당 단락으로 스크롤(para-flash)
  await report.locator(".rp-node").first().click();
  await expect(page.locator(".para-flash").first()).toBeVisible({ timeout: 2000 });
});

test("멘탈 모델 맵: 개념 엣지(어휘 중첩) — 곡선 + 범례", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");
  await page.evaluate(() => window.__layer2Demo.seed());
  await page.click("#menu-records");

  // 범례 + 곡선(SVG path)이 떠야 한다. 곡선은 패널이 보일 때 rAF/ResizeObserver
  // 로 실측 후 그려지므로 약간의 대기.
  await expect(page.locator("#m-microreport .rp-edges-legend")).toBeVisible();
  await expect
    .poll(() => page.locator("#m-microreport .rp-edge").count(), { timeout: 3000 })
    .toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/report-edges.png", fullPage: true });
});

test("멘탈 모델 맵: 흔적 없으면 안내 폴백", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");
  await page.click("#menu-records");
  await expect(page.locator("#m-microreport .report-empty")).toBeVisible();
});
