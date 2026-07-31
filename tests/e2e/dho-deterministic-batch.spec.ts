import { expect, test } from "@playwright/test";
import { DeterministicRuntime } from "../../packages/deterministic-runtime/src";
import { compilePrimary, fixtureOrigin, withManagedBrowser } from "./helpers";

const instruction =
  "Rechercher le premier chiffre entre 50 et 5000, exclure 53,90. Si le mot-clé VIR est détecté, cocher la première case Entente Directe. Répéter 20 fois.";

test("selected popup text compiles to DHO extraction, conditional VIR and twenty local runs", async () => {
  await withManagedBrowser(
    `${fixtureOrigin}/fixture/dho-batch/list`,
    async ({ browser, page, recorder }) => {
      await recorder.start();
      await page
        .getByRole("link", { name: "Coder ce dossier", exact: true })
        .first()
        .click();

      const sourcePromise = page.waitForEvent("popup");
      await page
        .getByRole("button", { name: "Ouvrir le texte source", exact: true })
        .click();
      const sourcePopup = await sourcePromise;
      const sourceZone = sourcePopup
        .locator('[data-vc-field="dho-copy-zone"] > span')
        .last();
      await sourceZone.selectText();
      await sourcePopup.keyboard.press("ControlOrMeta+c");
      await sourcePopup.waitForEvent("close");

      await page.getByLabel("Première case DHO", { exact: true }).fill("101");
      await page
        .getByLabel("Première case DHO", { exact: true })
        .press("Enter");
      await page.getByLabel("Entente Directe", { exact: true }).check();

      const validationPromise = page.waitForEvent("popup");
      await page
        .getByRole("link", {
          name: "Ouvrir la validation finale",
          exact: true,
        })
        .click();
      const validationPopup = await validationPromise;
      await validationPopup
        .getByLabel("Contrôle final", { exact: true })
        .check();
      await validationPopup
        .getByRole("button", { name: "Valider et fermer", exact: true })
        .click();
      await page.waitForURL("**/fixture/dho-batch/list");
      const session = await recorder.stop();

      const extract = session.actions.find(
        (action) => action.action === "extract",
      );
      expect(extract).toMatchObject({
        outputVariable: "copied_text_1",
        extractionSelection: {
          mode: "text-range",
        },
      });
      const ententeChecks = session.actions.filter(
        (action) =>
          action.action === "check" &&
          action.target?.stableAttributes.name?.startsWith("entente_directe"),
      );
      expect(ententeChecks).toHaveLength(1);
      expect(ententeChecks[0]?.target?.stableAttributes.name).toBe(
        "entente_directe_tout",
      );
      expect(
        session.actions.filter(
          (action) =>
            action.action === "keyboard" &&
            ["Meta+c", "Control+c"].includes(action.key ?? ""),
        ),
      ).not.toHaveLength(0);

      const workflow = await compilePrimary({
        browser,
        session,
        values: recorder.localValues,
        instruction,
      });
      expect(workflow.compilationMetadata.model).toBe("gpt-5.6");
      expect(workflow.compilationMetadata.modelCalls).toBe(1);
      expect(workflow.compileMode).toBe("mock-ai-generalization");
      expect(workflow.loops[0]).toMatchObject({
        nextItemRelationship: "next-row",
        maximumIterations: 20,
        duplicateItemProtection: true,
        executionScope: "workflow",
      });
      const dhoFill = workflow.steps.find(
        (step) =>
          step.action === "fill" &&
          step.target?.stableAttributes.name === "dho_1",
      );
      expect(dhoFill).toMatchObject({
        value: {
          kind: "runtime-variable",
          name: "copied_text_1",
          persistence: "memory-only",
        },
        valueTransforms: [
          {
            type: "number-in-range",
            minimum: 50,
            maximum: 5000,
            excludedNumbers: [53.9],
          },
        ],
      });
      const ententeStep = workflow.steps.find(
        (step) =>
          step.action === "check" &&
          step.target?.stableAttributes.name === "entente_directe_tout",
      );
      expect(ententeStep?.executionGuard).toMatchObject({
        variableName: "copied_text_1",
        keyword: "VIR",
      });
      expect(
        workflow.steps.some(
          (step) =>
            step.action === "keyboard" &&
            ["Meta+c", "Control+c"].includes(step.key ?? ""),
        ),
      ).toBe(false);
      expect(
        workflow.steps.some((step, index) => {
          const previous = workflow.steps[index - 1];
          return (
            step.action === "submit" &&
            previous?.action === "click" &&
            previous.pageContextId === step.pageContextId &&
            previous.target?.fingerprint === step.target?.fingerprint
          );
        }),
      ).toBe(false);

      await page.evaluate(() => {
        sessionStorage.setItem("vc2-dho-results", "[]");
        sessionStorage.removeItem("vc2-dho-current");
        sessionStorage.setItem("vc2-dho-uniform-labels", "true");
        sessionStorage.setItem("vc2-dho-remove-processed", "true");
      });
      await browser.navigate(`${fixtureOrigin}/fixture/dho-batch/list`);
      const firstRun = await new DeterministicRuntime({
        context: browser.context,
        workflow,
        variables: {},
        mode: "local",
      }).run();
      expect(
        firstRun.state,
        JSON.stringify({
          error: firstRun.error,
          loop: firstRun.loop,
          recentSteps: firstRun.steps.slice(-4),
          firstClickLocators: workflow.steps
            .find((step) => step.action === "click")
            ?.locatorCandidates.map((candidate) => ({
              strategy: candidate.strategy,
              preview: candidate.selectorPreview,
              rule: candidate.rule,
            })),
        }),
      ).toMatch(/Passed|CompletedUnverified/);
      expect(firstRun.loop).toEqual({
        requestedIterations: 20,
        completedIterations: 20,
        duplicateProtectionTriggered: false,
      });
      expect(firstRun.llmCalls).toBe(0);
      expect(firstRun.openAIRequests).toBe(0);
      expect(firstRun.extractionAudit).toHaveLength(20);
      expect(JSON.stringify(firstRun)).not.toContain("Référence exclue");
      expect(JSON.stringify(firstRun)).not.toContain("Règlement standard");
      expect(
        firstRun.extractionAudit.every(
          (entry) =>
            entry.rawTextPersisted === false &&
            entry.eligibleNumberFound &&
            entry.excludedNumericCandidates === 1,
        ),
      ).toBe(true);
      const results = await page.evaluate(
        () =>
          JSON.parse(
            sessionStorage.getItem("vc2-dho-results") || "[]",
          ) as Array<{
            record: number;
            amount: string;
            directAgreement: boolean;
          }>,
      );
      expect(results).toHaveLength(20);
      expect(results.map((result) => result.amount)).toEqual(
        Array.from({ length: 20 }, (_, index) => String(101 + index)),
      );
      expect(
        results.every(
          (result) => result.directAgreement === (result.record % 2 === 1),
        ),
      ).toBe(true);

      await page.evaluate(() =>
        sessionStorage.setItem("vc2-dho-results", "[]"),
      );
      await browser.navigate(`${fixtureOrigin}/fixture/dho-batch/list`);
      const secondRun = await new DeterministicRuntime({
        context: browser.context,
        workflow,
        variables: {},
        mode: "local",
      }).run();
      expect(secondRun.state, secondRun.error).toMatch(
        /Passed|CompletedUnverified/,
      );
      expect(secondRun.loop?.completedIterations).toBe(20);
      expect(secondRun.llmCalls).toBe(0);
      expect(secondRun.openAIRequests).toBe(0);
    },
  );
});
