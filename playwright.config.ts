import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "VC_HEADLESS=1 VC_TEST_MODE=1 npm run dev",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
