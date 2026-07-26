import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAB_TARGET_URL,
  resolveConfiguredTarget,
} from "../../apps/studio/backend/src/server";
import { isOpenAIUrl } from "../../packages/shared/src";
import { safeTelemetryMessage } from "../../packages/telemetry/src";

describe("zero-OpenAI runtime boundary", () => {
  it("has no OpenAI dependency or import in runtime source", async () => {
    const [source, packageJson] = await Promise.all([
      readFile(
        path.resolve("packages/deterministic-runtime/src/index.ts"),
        "utf8",
      ),
      readFile(
        path.resolve("packages/deterministic-runtime/package.json"),
        "utf8",
      ),
    ]);
    expect(source).not.toMatch(/from\s+["']openai["']/);
    expect(source).not.toMatch(/@openai\//);
    expect(JSON.parse(packageJson).dependencies?.openai).toBeUndefined();
  });

  it("blocks HTTP and WebSocket OpenAI endpoints before network dispatch", () => {
    expect(isOpenAIUrl("https://api.openai.com/v1/responses")).toBe(true);
    expect(isOpenAIUrl("wss://api.openai.com/v1/realtime")).toBe(true);
    expect(isOpenAIUrl("http://127.0.0.1:4273/fixture")).toBe(false);
  });

  it("runs independently of OPENAI_API_KEY", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(isOpenAIUrl("http://127.0.0.1:4273/fixture")).toBe(false);
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  });

  it("redacts query parameters and secret-shaped telemetry values", () => {
    const safe = safeTelemetryMessage(
      "failed at http://local.test/path?patient=123 token=abc",
    );
    expect(safe).toContain("http://local.test/path");
    expect(safe).not.toContain("patient=123");
    expect(safe).toContain("token=[REDACTED]");
  });

  it("redacts form values, cookies and authentication data from diagnostics", () => {
    const formValue = "LOCAL-FORM-VALUE";
    const safe = safeTelemetryMessage(
      `compile failed for ${formValue} at http://local.test/path?record=${formValue}&mode=test cookie=session token=abc Authorization=Bearer credential`,
      [formValue],
    );
    expect(safe).toContain("http://local.test/path");
    expect(safe).not.toContain(formValue);
    expect(safe).not.toContain("record=");
    expect(safe).not.toContain("session");
    expect(safe).not.toContain("credential");
    expect(safe).toContain("cookie=[REDACTED]");
    expect(safe).toContain("token=[REDACTED]");
  });

  it("rejects the real DPI and every remote host in automated test mode", () => {
    expect(() =>
      resolveConfiguredTarget({
        testMode: true,
        targetUrl: DEFAULT_LAB_TARGET_URL,
      }),
    ).toThrow("only an explicit local synthetic URL");
    expect(() =>
      resolveConfiguredTarget({
        testMode: true,
        targetUrl: "https://example.test/fixture",
      }),
    ).toThrow("only an explicit local synthetic URL");
    expect(
      resolveConfiguredTarget({
        testMode: true,
        targetUrl: "http://127.0.0.1:4273/fixture?variant=A",
      }).canonicalTarget,
    ).toBe("http://127.0.0.1:4273/fixture");
  });

  it("pins the checked-in E2E web server to explicit local test mode", async () => {
    const config = await readFile(path.resolve("playwright.config.ts"), "utf8");
    expect(config).toContain("VC_TEST_MODE=1");
    expect(config).toContain(
      "VISUAL_COMPILER_TEST_TARGET_URL='http://127.0.0.1:4273/fixture?variant=A'",
    );
    expect(config).not.toContain("VISUAL_COMPILER_TARGET_URL=");
  });
});
