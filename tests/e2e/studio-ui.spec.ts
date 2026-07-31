import { expect, test } from "@playwright/test";
import {
  DEFAULT_LAB_TARGET_URL,
  resolveConfiguredTarget,
} from "../../apps/studio/backend/src/server";

test("Studio exposes the simplified OPEN → TEACH → COMPILE → RUN LOCALLY flow", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("LAB MODE", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Visual Compiler 2", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Runtime LLM calls")).toBeVisible();
  await expect(page.getByText("Runtime OpenAI requests")).toBeVisible();
  const flow = page.locator(".flow-map");
  await expect(flow.locator("span").nth(0)).toContainText("Open");
  await expect(flow.locator("span").nth(1)).toContainText("Teach");
  await expect(flow.locator("span").nth(2)).toContainText("Compile");
  await expect(flow.locator("span").nth(3)).toContainText("Run locally");
  await expect(
    page.getByRole("button", { name: "1st run — animated" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Run again" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reset workflow", exact: true }),
  ).toBeVisible();

  await expect(page.locator("#advancedDetails")).not.toHaveAttribute("open");
  await expect(page.locator("#optionalAiDetails")).not.toHaveAttribute("open");
  await expect(page.getByText("Demonstration IR")).not.toBeVisible();
  await expect(page.getByText("Derived outcome evidence")).not.toBeVisible();

  await expect(
    page.getByText("Synthetic application profile", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/Legacy DPI · layout/)).toHaveCount(0);
  await expect(page.getByText("Contenteditable editor")).toHaveCount(0);
  await expect(page.getByText("Same-origin iframe editor")).toHaveCount(0);
  await expect(page.getByText("Legacy editor facade")).toHaveCount(0);
  await expect(page.getByText("Popup-centric workflow")).toHaveCount(0);
  await expect(page.locator("select#targetUrl")).toHaveCount(0);
});

test("test mode opens the configured local target automatically with recording off", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#studioState")).toHaveText("READY_TO_TEACH");
  await expect(page.locator("#browserStatus")).toHaveText("OPEN");
  await expect(page.locator("#recorderStatus")).toHaveText("OFF");
  await expect(page.locator("#canonicalPage")).toHaveText(
    `http://127.0.0.1:${process.env.VC_FIXTURE_PORT ?? "4273"}/fixture`,
  );
  await expect(
    page.getByRole("button", { name: "Start teaching", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", {
      name: "Reopen managed browser",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Return to DPI home", exact: true }),
  ).toBeVisible();
});

test("Studio panel text is mouse-selectable and copyable with the standard shortcut", async ({
  page,
}) => {
  await page.goto("/");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await page.locator("#advancedDetails > summary").click();
  await page.getByText("Demonstration IR", { exact: true }).click();
  const panel = page.locator("#demonstrationJson");
  await expect(panel).toBeVisible();
  expect(
    await panel.evaluate((element) => getComputedStyle(element).userSelect),
  ).toBe("text");
  await panel.click({ clickCount: 3 });
  expect(
    await page.evaluate(() => globalThis.getSelection()?.toString() ?? ""),
  ).toContain("No demonstration recorded");
  await page.keyboard.press("Meta+c");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("No demonstration recorded");

  await page.getByText("Redacted copied-text audit", { exact: true }).click();
  const extractionAudit = page.locator("#extractionAudit");
  await expect(extractionAudit).toBeVisible();
  expect(
    await extractionAudit.evaluate(
      (element) => getComputedStyle(element).userSelect,
    ),
  ).toBe("text");
  await expect(extractionAudit).toContainText(
    "Raw copied text is never persisted",
  );
});

test("production configuration defaults to the DPI home without contacting it", () => {
  const previous = process.env.VISUAL_COMPILER_TARGET_URL;
  delete process.env.VISUAL_COMPILER_TARGET_URL;
  try {
    expect(resolveConfiguredTarget({ testMode: false })).toEqual({
      testMode: false,
      targetUrl: DEFAULT_LAB_TARGET_URL,
      canonicalTarget: DEFAULT_LAB_TARGET_URL,
    });
    expect(() =>
      resolveConfiguredTarget({
        testMode: true,
        targetUrl: DEFAULT_LAB_TARGET_URL,
      }),
    ).toThrow("only an explicit local synthetic URL");
  } finally {
    if (previous === undefined) delete process.env.VISUAL_COMPILER_TARGET_URL;
    else process.env.VISUAL_COMPILER_TARGET_URL = previous;
  }
});
