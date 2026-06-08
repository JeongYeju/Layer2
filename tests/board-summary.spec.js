import { test, expect } from "@playwright/test";

// 내재화 C — 보드 "내 말 요약" 시각 검증.
// `npm run test:headed`
// 키 없이도 흔적(주석·밑줄) 기반 초안 폴백이 떠야 하고, 편집이 소스별로 저장돼야 함.

test('보드 "내 말 요약": 초안 만들기(폴백) → 편집 → 저장', async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".para[data-paragraph-id]");

  // 더미 신호(밑줄·주석 포함) 시드
  await page.evaluate(() => window.__layer2Demo.seed());

  // 보드 모드 → 요약 패널이 떠야 한다
  await page.click('#view-toggle button[data-mode="board"]');
  const panel = page.locator(".board-summary");
  await expect(panel).toBeVisible();
  await page.screenshot({ path: "test-results/board-summary-empty.png", fullPage: true });

  // 초안 만들기 (키 없음 → 흔적 기반 폴백 초안이 textarea 를 채운다)
  await panel.locator(".board-summary-gen").click();
  const ta = panel.locator(".board-summary-text");
  await expect(ta).not.toHaveValue("");
  await expect(ta).toHaveValue(/주목한 것|남긴 생각/);
  await page.screenshot({ path: "test-results/board-summary-draft.png" });

  // 편집 → 저장 표시
  await ta.fill("나는 이 글을 읽고 디지털 읽기의 마찰을 줄이는 게 핵심이라 느꼈다.");
  await expect(panel.locator(".board-summary-status")).toContainText("저장됨", {
    timeout: 2000,
  });

  // 소스별 영속: 스크롤로 나갔다 보드로 돌아와도 편집본 유지
  await page.click('#view-toggle button[data-mode="scroll"]');
  await page.click('#view-toggle button[data-mode="board"]');
  await expect(page.locator(".board-summary-text")).toHaveValue(
    /마찰을 줄이는 게 핵심/,
  );
});
