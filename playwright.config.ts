import { defineConfig } from "@playwright/test";

const studioPort = process.env.VC_STUDIO_PORT ?? "3100";
const fixturePort = process.env.VC_FIXTURE_PORT ?? "4273";
const studioOrigin = `http://127.0.0.1:${studioPort}`;
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  workers: 1,
  use: {
    baseURL: studioOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      `VC_HEADLESS=1 VC_TEST_MODE=1 VC_STUDIO_PORT=${studioPort} VC_FIXTURE_PORT=${fixturePort} VISUAL_COMPILER_TEST_TARGET_URL='${fixtureOrigin}/fixture?variant=A' npm run dev`,
    url: `${studioOrigin}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
