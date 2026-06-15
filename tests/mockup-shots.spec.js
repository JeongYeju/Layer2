import { test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

// 발표 첨부용 "읽기 후 · 내 패턴" 목업을 프레임별 PNG 로 뽑는다. (정지 이미지, 더미데이터)
//   실행:  npx playwright test mockup
//   결과:  docs/presentation/mockups/*.png  (full + 화면 4종)
// headless 라 창 안 떠도 되고, deviceScaleFactor 2 로 또렷하게.

const FILE = path.resolve("docs/presentation/mockups/post-reading-patterns.html");
const OUT = "docs/presentation/mockups";

const SHOTS = [
  "00-recommendation", // 후·01 다음 읽기 전 추천/맥락 카드
  "01-session-rhythm", // 후·02 다중세션 리포트 / 시간대 리듬
  "02-reread-mirror", // 후·03 재독 Diff / 다회독 거울
  "03-long-term", // 후·04 장기 패턴 (관심사/마찰 추이)
];

test.use({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 2 });

test("post-reading pattern mockups", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("file://" + FILE);
  await page.waitForTimeout(300);

  // 전체 갤러리 한 장 (참고용)
  await page.screenshot({ path: `${OUT}/_gallery-full.png`, fullPage: true });

  // 프레임(=한 화면) 단위로 깔끔하게 — 라벨 포함해서 캡처하려면 .item 을 떠도 됨.
  const frames = page.locator(".frame");
  const n = await frames.count();
  for (let i = 0; i < n && i < SHOTS.length; i++) {
    await frames.nth(i).scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
    await frames.nth(i).screenshot({ path: `${OUT}/${SHOTS[i]}.png` });
  }
});
