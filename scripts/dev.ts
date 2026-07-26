import { startStudioServer } from "../apps/studio/backend/src/server";
import { startSyntheticDpiServer } from "../apps/synthetic-dpi/src/server";

const fixtureHost = "127.0.0.1";
const studioHost = process.env.VC_STUDIO_HOST ?? "127.0.0.1";
const fixturePort = Number(process.env.VC_FIXTURE_PORT ?? 4273);
const studioPort = Number(process.env.VC_STUDIO_PORT ?? 3100);

const fixture = await startSyntheticDpiServer(fixturePort, fixtureHost);
const { server: studio, controller } = await startStudioServer(
  studioPort,
  studioHost,
);

console.log(`Visual Compiler 2 Studio: http://${studioHost}:${studioPort}`);
console.log(
  `Synthetic DPI fixture: http://${fixtureHost}:${fixturePort}/fixture?variant=A`,
);
console.log("LAB MODE — synthetic test records only");

async function shutdown() {
  await controller.browser.close().catch(() => undefined);
  await Promise.all([
    new Promise<void>((resolve) => fixture.close(() => resolve())),
    new Promise<void>((resolve) => studio.close(() => resolve())),
  ]);
}

process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
