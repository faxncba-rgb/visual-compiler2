import { expect, test } from "@playwright/test";
import { DeterministicRuntime } from "../../packages/deterministic-runtime/src";
import { compilePrimary, fixtureOrigin, withManagedBrowser } from "./helpers";

test("copy and paste compile to memory-only cross-page dataflow", async () => {
  await withManagedBrowser(
    `${fixtureOrigin}/fixture/dataflow-source`,
    async ({ browser, page, recorder }) => {
      const copiedContent = "SYNTHETIC-RUNTIME-COPIED-CONTENT";
      await recorder.start();
      const source = page.getByLabel("Texte source", { exact: true });
      await source.focus();
      await source.selectText();
      await source.dispatchEvent("copy");
      await page
        .getByRole("link", { name: "Ouvrir la destination", exact: true })
        .click();
      const destination = page.getByLabel("Texte destination", {
        exact: true,
      });
      await destination.dispatchEvent("paste");
      await destination.fill(copiedContent);
      const session = await recorder.stop();

      const extract = session.actions.find(
        (action) => action.action === "extract",
      );
      const fill = session.actions.find((action) => action.action === "fill");
      expect(extract?.outputVariable).toBe("copied_text_1");
      expect(fill?.value).toEqual({
        kind: "runtime-variable",
        name: "copied_text_1",
        persistence: "memory-only",
      });
      expect(
        session.variables.find((variable) => variable.name === "copied_text_1")
          ?.privacy,
      ).toBe("runtime-derived");
      expect(JSON.stringify(session)).not.toContain(copiedContent);

      const workflow = await compilePrimary({
        browser,
        session,
        values: {},
      });
      expect(JSON.stringify(workflow)).not.toContain(copiedContent);
      expect(workflow.compilationMetadata.generatedPlaywright).not.toContain(
        copiedContent,
      );

      await browser.navigate(`${fixtureOrigin}/fixture/dataflow-source`);
      const telemetry = await new DeterministicRuntime({
        context: browser.context,
        workflow,
        variables: {},
        mode: "local",
      }).run();
      expect(telemetry.state, telemetry.error).toBe("CompletedUnverified");
      expect(telemetry.llmCalls).toBe(0);
      expect(telemetry.openAIRequests).toBe(0);
      await expect(
        page.getByLabel("Texte destination", { exact: true }),
      ).toHaveValue(copiedContent);
      expect(JSON.stringify(telemetry)).not.toContain(copiedContent);
    },
  );
});
