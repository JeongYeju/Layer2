import { defineConfig } from "@playwright/test";

// 헤드풀(실제 창) 검증이 기본. 로컬: `npm run test:headed` 로 창 보며 확인.
// CI 환경(CI=1)에선 화면이 없으니 자동으로 headless 로 떨어진다.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8000",
    headless: !!process.env.CI,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
  },
  // 정적 사이트라 빌드 없이 파이썬 서버로 그대로 서빙한다.
  webServer: {
    command: "python3 -m http.server 8000",
    url: "http://localhost:8000",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
