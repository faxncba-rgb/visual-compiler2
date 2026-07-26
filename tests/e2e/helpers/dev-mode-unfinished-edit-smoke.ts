import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DemonstrationRecorder } from "../../../packages/demonstration-recorder/src";
import { ManagedBrowser } from "../../../packages/managed-browser/src";

const profileDirectory = await mkdtemp(
  path.join(os.tmpdir(), "visual-compiler-2-unfinished-edit-"),
);
const browser = new ManagedBrowser({
  profileDirectory,
  headless: true,
});
const fixtureOrigin = `http://127.0.0.1:${process.env.VC_FIXTURE_PORT ?? "4273"}`;

try {
  const page = await browser.open(`${fixtureOrigin}/fixture?variant=A`);
  const recorder = new DemonstrationRecorder(browser.context, browser.graph);
  await recorder.attach();
  await recorder.start();
  await page!
    .frameLocator('iframe[title="Éditeur de consultation"]')
    .getByLabel("Texte de consultation", { exact: true })
    .fill("SYNTHETIC-UNFINISHED-EDIT");
  await page!.locator('iframe[title="Éditeur de consultation"]').evaluate(
    (frame) => frame.remove(),
  );
  const session = await recorder.stop();
  console.log(
    JSON.stringify({
      fillCount: session.actions.filter((action) => action.action === "fill")
        .length,
      actionCount: session.actions.length,
    }),
  );
} finally {
  await browser.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
