import { expect, test } from "@playwright/test";

test("Studio exposes permanent Lab Mode, privacy boundaries, and both optional run modes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("LAB MODE — synthetic test records only", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Visual Compiler 2", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Compile-time model calls")).toBeVisible();
  await expect(page.getByText("Runtime LLM calls")).toBeVisible();
  await expect(page.getByText("Runtime OpenAI requests")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1st run — animated" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Run locally" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run locally" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Local runtime variables", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("AI generalization instructions", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Payload sent to AI/)).toBeVisible();
});

test("Studio binds to the synthetic fixture and keeps recording disabled during manual auth", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open managed browser" }).click();
  await expect(page.locator("#studioState")).toHaveText("AUTHENTICATING");
  await expect(
    page.getByRole("button", { name: "Start teaching" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Recording during login", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Authentication complete · ready" })
    .click();
  await expect(page.locator("#studioState")).toHaveText("READY_TO_TEACH");
  await expect(
    page.getByRole("button", { name: "Start teaching" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.locator("#studioState")).toHaveText("IDLE");
});
