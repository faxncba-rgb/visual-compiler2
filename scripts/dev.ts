import { readFile, stat } from "node:fs/promises";
import path from "node:path";
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

async function loadCompileApiKey() {
  const filename = path.resolve(process.cwd(), ".env.local");
  try {
    const metadata = await stat(filename);
    if ((metadata.mode & 0o077) !== 0)
      throw new Error(
        ".env.local must be readable and writable only by its owner (0600).",
      );
    const contents = await readFile(filename, "utf8");
    const assignment = contents
      .split(/\r?\n/)
      .find((line) => line.trimStart().startsWith("OPENAI_API_KEY="));
    if (!assignment) return undefined;
    const rawValue = assignment.slice(assignment.indexOf("=") + 1).trim();
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    return value || undefined;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return undefined;
    throw error;
  }
}

const compileApiKey = testMode ? undefined : await loadCompileApiKey();
delete process.env.OPENAI_API_KEY;

const fixture = testMode
  ? await startSyntheticDpiServer(fixturePort, fixtureHost)
  : undefined;
const { server: studio, controller } = await startStudioServer(
  studioPort,
  studioHost,
  testMode
    ? { testMode: true, targetUrl: testTargetUrl }
    : compileApiKey
      ? { compileApiKey }
      : {},
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
