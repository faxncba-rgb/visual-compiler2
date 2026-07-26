import { startStudioServer } from "../apps/studio/backend/src/server";
import { startSyntheticDpiServer } from "../apps/synthetic-dpi/src/server";

const fixtureHost = "127.0.0.1";
const studioHost = process.env.VC_STUDIO_HOST ?? "127.0.0.1";
const fixturePort = Number(process.env.VC_FIXTURE_PORT ?? 4273);
const studioPort = Number(process.env.VC_STUDIO_PORT ?? 3100);
const testMode = process.env.VC_TEST_MODE === "1";
const testTargetUrl =
  process.env.VISUAL_COMPILER_TEST_TARGET_URL ??
  `http://${fixtureHost}:${fixturePort}/fixture?variant=A`;

const fixture = testMode
  ? await startSyntheticDpiServer(fixturePort, fixtureHost)
  : undefined;
const { server: studio, controller } = await startStudioServer(
  studioPort,
  studioHost,
  testMode ? { testMode: true, targetUrl: testTargetUrl } : {},
);

console.log(`Visual Compiler 2 Studio: http://${studioHost}:${studioPort}`);
if (testMode) console.log(`Internal test fixture: ${testTargetUrl}`);
console.log("LAB MODE — local demonstration compiler");

async function shutdown() {
  await controller.browser.close().catch(() => undefined);
  await Promise.all(
    [
      fixture
        ? new Promise<void>((resolve) => fixture.close(() => resolve()))
        : undefined,
      new Promise<void>((resolve) => studio.close(() => resolve())),
    ].filter((operation): operation is Promise<void> => Boolean(operation)),
  );
}

process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
