import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { ManagedBrowser } from "../../packages/managed-browser/src";
import { DemonstrationRecorder } from "../../packages/demonstration-recorder/src";
import { compileDemonstration } from "../../packages/generalization-compiler/src";
import type {
  CompiledWorkflow,
  DemonstrationSession,
} from "../../packages/demonstration-ir/src";

export const fixtureOrigin = `http://127.0.0.1:${process.env.VC_FIXTURE_PORT ?? "4273"}`;

export async function consultationEditor(page: Page) {
  if (
    (await page.locator('iframe[title="Éditeur de consultation"]').count()) > 0
  )
    return page
      .frameLocator('iframe[title="Éditeur de consultation"]')
      .getByLabel("Texte de consultation", { exact: true });
  return page.getByLabel("Texte de consultation", { exact: true });
}

export async function withManagedBrowser<T>(
  url: string,
  operation: (details: {
    browser: ManagedBrowser;
    page: Page;
    recorder: DemonstrationRecorder;
  }) => Promise<T>,
) {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "visual-compiler-2-e2e-"),
  );
  const browser = new ManagedBrowser({
    profileDirectory: temporaryDirectory,
    headless: true,
  });
  try {
    const page = await browser.open(url);
    const recorder = new DemonstrationRecorder(browser.context, browser.graph);
    await recorder.attach();
    return await operation({ browser, page: page!, recorder });
  } finally {
    await browser.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function teachPrimaryWorkflow(details: {
  page: Page;
  recorder: DemonstrationRecorder;
  value?: string;
}) {
  const { page, recorder } = details;
  const value = details.value ?? "Consultation synthétique locale VC2";

  // Authentication/manual-navigation phase: recorder is attached but inactive.
  const authenticationEditor = await consultationEditor(page);
  await authenticationEditor.fill("AUTH-PHASE-NOT-RECORDED");
  await page.waitForTimeout(380);
  if (recorder.status().actionCount !== 0)
    throw new Error("Recorder captured an event before Start teaching.");

  await recorder.start();

  // Password controls are never allowed into the recording session.
  await page.evaluate(() => {
    const password = document.createElement("input");
    password.type = "password";
    password.setAttribute("aria-label", "Synthetic password");
    document.body.append(password);
  });
  await page.getByLabel("Synthetic password").fill("NEVER-RECORD-THIS");

  const editor = await consultationEditor(page);
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await editor.pressSequentially(value);
  await page.getByText("Enregistrer", { exact: true }).click();
  await page
    .getByText("Consultation synthétique enregistrée.", { exact: true })
    .waitFor();
  await page
    .locator("[data-vc-consultation-history] > li")
    .filter({ hasText: "Consultation synthétique enregistrée" })
    .waitFor();
  await consultationEditor(page);
  const session = await recorder.stop();
  return {
    session,
    values: recorder.localValues,
    demonstratedValue: value,
  };
}

export async function compilePrimary(details: {
  browser: ManagedBrowser;
  session: DemonstrationSession;
  values: Record<string, string>;
  instruction?: string;
}): Promise<CompiledWorkflow> {
  const result = await compileDemonstration({
    session: details.session,
    graph: details.browser.graph,
    localValues: details.values,
    generalizationInstruction: details.instruction ?? "",
  });
  return result.workflow;
}
