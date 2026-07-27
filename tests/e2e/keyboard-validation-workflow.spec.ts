import { expect, test } from "@playwright/test";
import { DeterministicRuntime } from "../../packages/deterministic-runtime/src";
import {
  compileDemonstration,
  MockGeneralizationProvider,
} from "../../packages/generalization-compiler/src";
import { fixtureOrigin, withManagedBrowser } from "./helpers";

test("click → c → Enter → Valider compiles and runs locally in order", async () => {
  await withManagedBrowser(
    `${fixtureOrigin}/fixture/keyboard-validation`,
    async ({ browser, page, recorder }) => {
      await recorder.start();

      await page
        .getByRole("button", { name: "Choisir une catégorie", exact: true })
        .click();
      const listbox = page.getByRole("listbox", {
        name: "Catégories de consultation",
        exact: true,
      });
      await listbox.press("c");
      await listbox.press("Enter");
      await page.getByRole("button", { name: "Valider", exact: true }).click();
      await expect(
        page.getByText("Catégorie Consultation validée.", { exact: true }),
      ).toBeVisible();

      const session = await recorder.stop();
      const demonstrated = session.actions.filter((action) =>
        ["click", "keyboard"].includes(action.action),
      );
      expect(
        demonstrated.map((action) =>
          action.action === "keyboard"
            ? `${action.action}:${action.key}`
            : `${action.action}:${action.target?.accessibleName}`,
        ),
      ).toEqual([
        "click:Choisir une catégorie",
        "keyboard:c",
        "keyboard:Enter",
        "click:Valider",
      ]);

      const { workflow } = await compileDemonstration({
        session,
        graph: browser.graph,
        localValues: recorder.localValues,
        provider: new MockGeneralizationProvider(),
      });
      expect(
        workflow.steps
          .filter((step) => ["click", "keyboard"].includes(step.action))
          .map((step) =>
            step.action === "keyboard"
              ? `${step.action}:${step.key}`
              : `${step.action}:${step.target?.accessibleName}`,
          ),
      ).toEqual([
        "click:Choisir une catégorie",
        "keyboard:c",
        "keyboard:Enter",
        "click:Valider",
      ]);
      const keyboardSteps = workflow.steps.filter(
        (step) => step.action === "keyboard",
      );
      expect(
        keyboardSteps.map((step) => ({
          key: step.key,
          scope: step.keyboardScope,
          target: step.target?.accessibleName,
        })),
      ).toEqual([
        {
          key: "c",
          scope: "focused-element",
          target: "Catégories de consultation",
        },
        {
          key: "Enter",
          scope: "focused-element",
          target: "Catégories de consultation",
        },
      ]);
      expect(
        keyboardSteps.every((step) =>
          step.locatorCandidates.some((candidate) =>
            candidate.explanation.includes("capture-time evidence"),
          ),
        ),
      ).toBe(true);
      const validateStep = workflow.steps.find(
        (step) => step.target?.accessibleName === "Valider",
      );
      expect(validateStep?.selectedLocatorId).toBeTruthy();
      expect(validateStep?.sourceActionId).not.toBe(
        keyboardSteps.at(-1)?.sourceActionId,
      );

      await browser.navigate(`${fixtureOrigin}/fixture/keyboard-validation`);
      const telemetry = await new DeterministicRuntime({
        context: browser.context,
        workflow,
        variables: {},
        mode: "local",
      }).run();
      expect(telemetry.state).toBe("Passed");
      expect(telemetry.llmCalls).toBe(0);
      expect(telemetry.openAIRequests).toBe(0);
      await expect(
        page.getByText("Catégorie Consultation validée.", { exact: true }),
      ).toBeVisible();
    },
  );
});

test("a page-level significant key compiles and runs without an element locator", async () => {
  await withManagedBrowser(
    `${fixtureOrigin}/fixture/keyboard-validation`,
    async ({ browser, page, recorder }) => {
      await recorder.start();
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
      });
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Choisir une catégorie", exact: true })
        .click();
      const listbox = page.getByRole("listbox", {
        name: "Catégories de consultation",
        exact: true,
      });
      await listbox.press("c");
      await listbox.press("Enter");
      await page.getByRole("button", { name: "Valider", exact: true }).click();
      const session = await recorder.stop();
      const pageKey = session.actions.find(
        (action) =>
          action.action === "keyboard" && action.keyboardScope === "page",
      );
      expect(pageKey).toMatchObject({ key: "Escape" });
      expect(pageKey?.target).toBeUndefined();

      const { workflow } = await compileDemonstration({
        session,
        graph: browser.graph,
        localValues: recorder.localValues,
        provider: new MockGeneralizationProvider(),
      });
      const pageKeyStep = workflow.steps.find(
        (step) => step.sourceActionId === pageKey?.id,
      );
      expect(pageKeyStep).toMatchObject({
        action: "keyboard",
        key: "Escape",
        keyboardScope: "page",
        locatorCandidates: [],
      });
      expect(pageKeyStep?.selectedLocatorId).toBeUndefined();

      await browser.navigate(`${fixtureOrigin}/fixture/keyboard-validation`);
      const telemetry = await new DeterministicRuntime({
        context: browser.context,
        workflow,
        variables: {},
        mode: "local",
      }).run();
      expect(telemetry.state).toBe("Passed");
      expect(telemetry.llmCalls).toBe(0);
      expect(telemetry.openAIRequests).toBe(0);
    },
  );
});
