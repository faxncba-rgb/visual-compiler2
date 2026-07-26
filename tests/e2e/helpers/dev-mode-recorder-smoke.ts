import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DemonstrationRecorder } from "../../../packages/demonstration-recorder/src";
import { ManagedBrowser } from "../../../packages/managed-browser/src";

const profileDirectory = await mkdtemp(
  path.join(os.tmpdir(), "visual-compiler-2-dev-recorder-"),
);
const browser = new ManagedBrowser({
  profileDirectory,
  headless: true,
});

try {
  const page = await browser.open("http://127.0.0.1:4273/fixture?variant=A");
  const recorder = new DemonstrationRecorder(browser.context, browser.graph);
  await recorder.attach();
  await recorder.start();

  const editor = page!
    .frameLocator('iframe[title="Éditeur de consultation"]')
    .getByLabel("Texte de consultation", { exact: true });
  await editor.click();
  await editor.pressSequentially("SYNTHETIC-DEV-MODE-CALLBACK");
  await page!.waitForTimeout(1_100);
  await page!.getByText("Enregistrer", { exact: true }).click();
  await page!
    .getByText("Consultation synthétique enregistrée.", { exact: true })
    .waitFor();

  const session = await recorder.stop();
  const fills = session.actions.filter((action) => action.action === "fill");
  const save = session.actions.find(
    (action) =>
      action.action === "click" &&
      action.target?.accessibleName === "Enregistrer",
  );
  console.log(
    JSON.stringify({
      fillCount: fills.length,
      stable: session.effectReconciliation?.status,
      historyCount: session.applicationStateAfter?.historyCount,
      saveLinkedToFill: save?.sequenceContext?.savesPreviousEditor,
      hostFormName: fills[0]?.target?.descriptor?.hostFormName,
    }),
  );
} finally {
  await browser.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
