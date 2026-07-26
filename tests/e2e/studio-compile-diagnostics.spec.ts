import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  StudioController,
  createStudioServer,
} from "../../apps/studio/backend/src/server";

async function listenOnEphemeralPort(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Studio did not expose a local TCP address.");
  return `http://127.0.0.1:${address.port}`;
}

async function withIsolatedStudio(
  operation: (details: {
    controller: StudioController;
    rootDirectory: string;
    studioOrigin: string;
  }) => Promise<void>,
) {
  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), "visual-compiler-2-studio-e2e-"),
  );
  const previousHeadless = process.env.VC_HEADLESS;
  process.env.VC_HEADLESS = "1";
  const controller = new StudioController(rootDirectory);
  const server = createStudioServer(controller);
  try {
    const studioOrigin = await listenOnEphemeralPort(server);
    await operation({ controller, rootDirectory, studioOrigin });
  } finally {
    if (previousHeadless === undefined) delete process.env.VC_HEADLESS;
    else process.env.VC_HEADLESS = previousHeadless;
    await controller.browser.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(rootDirectory, { recursive: true, force: true });
  }
}

async function teachLegacyLayoutA(
  page: Page,
  controller: StudioController,
  studioOrigin: string,
  demonstratedValue: string,
) {
  await page.goto(studioOrigin);
  await page
    .getByRole("button", { name: "Open managed browser", exact: true })
    .click();
  await expect(page.locator("#studioState")).toHaveText("AUTHENTICATING");
  await page
    .getByRole("button", {
      name: "Authentication complete · ready",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Start teaching", exact: true })
    .click();
  await expect(page.locator("#studioState")).toHaveText("RECORDING");

  const managedPage = controller.browser.mainPage;
  await managedPage
    .getByLabel("Texte de consultation", { exact: true })
    .fill(demonstratedValue);
  await managedPage
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await managedPage
    .getByText("Consultation synthétique enregistrée.", { exact: true })
    .waitFor();

  await page
    .getByRole("button", { name: "Stop teaching", exact: true })
    .click();
  await expect(page.locator("#studioState")).toHaveText("DEMONSTRATION_REVIEW");
  await expect(page.getByLabel("Instruction", { exact: true })).toHaveValue("");
}

test("Legacy DPI layout A compiles through the Studio response contract", async ({
  page,
}) => {
  await withIsolatedStudio(async ({ controller, studioOrigin }) => {
    const demonstratedValue = "SYNTHETIC-LEGACY-LAYOUT-A";
    await teachLegacyLayoutA(page, controller, studioOrigin, demonstratedValue);

    await page.getByRole("button", { name: "Compile", exact: true }).click();

    await expect(page.locator("#studioState")).toHaveText("READY_TO_RUN");
    await expect(page.locator("#toast")).toHaveText(
      "Validated artifact compiled. Animated and local run are both ready.",
    );
    await expect(page.locator("#toast")).not.toHaveClass(/error/);
    await expect(page.locator("#compilationDiagnostics")).toBeHidden();
    expect(controller.workflow?.compileMode).toBe("direct-demonstration");
    expect(
      controller.workflow?.steps.find((step) => step.action === "fill")?.target
        ?.associatedLabel,
    ).toBe("Texte de consultation");
    expect(JSON.stringify(controller.workflow)).not.toContain(
      demonstratedValue,
    );
  });
});

test("compile failures remain redacted, persistent, copyable and locally logged", async ({
  page,
}) => {
  await withIsolatedStudio(
    async ({ controller, rootDirectory, studioOrigin }) => {
      const demonstratedValue = "FORM-VALUE-MUST-NEVER-LEAK";
      await teachLegacyLayoutA(
        page,
        controller,
        studioOrigin,
        demonstratedValue,
      );
      controller.persistArtifacts = async () => {
        throw new Error(
          `Persistence rejected ${demonstratedValue} at http://local.test/compile?record=${demonstratedValue}&mode=test token=raw-token cookie=raw-cookie Authorization=Bearer raw-auth`,
        );
      };

      const terminalMessages: string[] = [];
      const originalConsoleError = console.error;
      console.error = (...values: unknown[]) => {
        terminalMessages.push(values.map(String).join(" "));
      };
      try {
        await page
          .getByRole("button", { name: "Compile", exact: true })
          .click();
        await expect(page.locator("#studioState")).toHaveText("FAILED");
        await expect(page.locator("#compilationDiagnostics")).toBeVisible();
      } finally {
        console.error = originalConsoleError;
      }

      await expect(page.locator("#diagnosticHttpStatus")).toHaveText("422");
      await expect(page.locator("#diagnosticCompilerStage")).toHaveText(
        "artifact-persistence",
      );
      const message = await page
        .locator("#diagnosticServerMessage")
        .innerText();
      expect(message).toContain("Persistence rejected");
      expect(message).toContain("http://local.test/compile");
      expect(message).not.toContain(demonstratedValue);
      expect(message).not.toContain("record=");
      expect(message).not.toContain("raw-token");
      expect(message).not.toContain("raw-cookie");
      expect(message).not.toContain("raw-auth");
      await expect(page.locator("#toast.error")).toBeHidden();

      await page.reload();
      await expect(page.locator("#compilationDiagnostics")).toBeVisible();
      await expect(page.locator("#diagnosticServerMessage")).toHaveText(
        message,
      );

      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"], {
          origin: studioOrigin,
        });
      await page
        .getByRole("button", { name: "Copy diagnostics", exact: true })
        .click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain("HTTP status: 422");
      expect(copied).toContain("Compiler stage: artifact-persistence");
      expect(copied).toContain(message);
      expect(copied).not.toContain(demonstratedValue);

      await page
        .getByRole("button", { name: "Studio log", exact: true })
        .click();
      await expect(page.locator("#studioEventLog")).toContainText(message);
      const persistedLog = await readFile(
        path.join(rootDirectory, "local-data", "studio-events.jsonl"),
        "utf8",
      );
      expect(persistedLog).toContain(message);
      expect(persistedLog).not.toContain(demonstratedValue);
      expect(persistedLog).not.toContain("record=");
      expect(persistedLog).not.toContain("raw-token");
      expect(persistedLog).not.toContain("raw-cookie");
      expect(persistedLog).not.toContain("raw-auth");

      const diagnostic = controller.compilationDiagnostic;
      expect(diagnostic).toBeDefined();
      expect(terminalMessages.join("\n")).toContain(JSON.stringify(diagnostic));
      expect(terminalMessages.join("\n")).not.toContain(demonstratedValue);

      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(page.locator("#compilationDiagnostics")).toBeHidden();
      await expect(page.locator("#studioEventLog")).toContainText(message);
    },
  );
});
