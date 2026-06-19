import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// 발표 백업용 데모 영상을 뽑는다 — 연출 드라이버(demo-director.js)의 AUTO 모드를
// Playwright 가 결정론적으로 재생하며 녹화한다. 스크롤·타이핑·촛불·맵·보드 전환이
// 매 녹화 동일하게 매끄럽다.
//   실행:  CI=1 npx playwright test demo-video
//   결과:  docs/presentation/demo/layer2-demo.webm  (+ ffmpeg 있으면 .mp4 변환)
//   발표:  이 영상을 틀어놓고 민서님이 말로 설명(폴백). 라이브는 STEP 모드(스페이스바).

const OUT = path.resolve("docs/presentation/demo");
// ⚠️ Playwright 함정: recordVideo.size 가 viewport 보다 크면 남는 영역이 회색으로
// 채워진다(deviceScaleFactor 로 영상 해상도가 올라가지 않음). 그래서 둘을 똑같이
// 1920×1080 으로 둔다 → 진짜 1080p, 회색 없음.
const SIZE = { width: 1920, height: 1080 };

test("layer2 director demo (auto, recorded)", async ({ browser }) => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: SIZE },
  });
  const page = await context.newPage();

  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => !!window.__layer2Director, null, { timeout: 20000 });

  // HUD 끄고 끝까지 자동 재생. start({auto}) 프로미스가 끝나면 시퀀스 완료.
  await page.evaluate(() => window.__layer2Director.start({ auto: true, hud: false }));
  await page.waitForTimeout(1500);

  const video = page.video();
  await context.close(); // 컨텍스트 닫을 때 영상이 파일로 확정된다
  if (video) {
    const src = await video.path();
    const dest = path.join(OUT, "layer2-demo.webm");
    fs.copyFileSync(src, dest);
    console.log("[demo-video] saved →", dest);
  }
});
