import { expect, test } from "@playwright/test";
import { DeterministicRuntime } from "../../packages/deterministic-runtime/src";
import {
  AiGeneralizationOutputSchema,
  compileDemonstration,
  MockGeneralizationProvider,
  type AiPayload,
} from "../../packages/generalization-compiler/src";
import { fixtureOrigin, withManagedBrowser } from "./helpers";

class EvidenceAwareMockProvider extends MockGeneralizationProvider {
  payload: AiPayload | undefined;

  override async generalize(payload: AiPayload) {
    this.payload = payload;
    const output = AiGeneralizationOutputSchema.parse(
      await super.generalize(payload),
    );
    const iconAction = payload.demonstration.actions.find((action) =>
      action.target?.clickEvidence?.canonicalHref?.endsWith(
        "/fixture/multidoc/codage_etage.cgi",
      ),
    );
    const recommendation = iconAction?.target?.locatorCandidates.find(
      (candidate) => candidate.strategy === "row-icon-context",
    );
    const enrichment = output.enrichments.find(
      (candidate) => candidate.sourceActionId === iconAction?.id,
    );
    if (enrichment && recommendation) {
      enrichment.intention =
        "Open the coding page for the demonstrated synthetic stay row.";
      enrichment.semanticTarget =
        "Anonymous coding link identified by row and icon evidence.";
      enrichment.recommendedLocator = recommendation;
      enrichment.confidence = 0.99;
    }
    return output;
  }
}

const consultationsPath = "/fixture/multidoc/consultations.cgi";
const staysPath = "/fixture/multidoc/sejours.cgi";
const codingPath = "/fixture/multidoc/codage_etage.cgi";

test("three documents, anonymous icon and c → Enter selection compile and rerun locally", async () => {
  await withManagedBrowser(
    `${fixtureOrigin}${consultationsPath}`,
    async ({ browser, page, recorder }) => {
      await recorder.start();

      await page
        .getByRole("link", { name: "Ouvrir les séjours", exact: true })
        .click();
      await page.waitForURL(`**${staysPath}`);
      await page.locator('img[title="Ouvrir le codage NGAP"]').click();
      await page.waitForURL(`**${codingPath}`);

      const select = page.getByLabel("Acte NGAP", { exact: true });
      await select.click();
      await select.press("c");
      await select.press("Enter");
      await expect(select).toHaveValue("214");
      await page
        .getByRole("button", {
          name: "Ajouter un code NGAP",
          exact: true,
        })
        .click();
      await expect(
        page.getByText("Code NGAP 214 ajouté.", { exact: true }),
      ).toBeVisible();

      const session = await recorder.stop();
      const documents = session.pages.filter((context) =>
        [consultationsPath, staysPath, codingPath].includes(context.pathname),
      );
      expect(documents).toHaveLength(3);
      expect(new Set(documents.map((context) => context.id)).size).toBe(3);
      expect(new Set(documents.map((context) => context.pageId)).size).toBe(1);
      expect(documents.map((context) => context.documentOrdinal)).toEqual(
        [...documents]
          .sort((left, right) => left.documentOrdinal - right.documentOrdinal)
          .map((context) => context.documentOrdinal),
      );

      const contextByPath = new Map(
        documents.map((context) => [context.pathname, context]),
      );
      const firstLink = session.actions.find(
        (action) => action.target?.accessibleName === "Ouvrir les séjours",
      );
      const iconClick = session.actions.find(
        (action) =>
          action.target?.clickEvidence?.canonicalHref ===
          `${fixtureOrigin}${codingPath}`,
      );
      const selection = session.actions.find(
        (action) =>
          action.action === "select" &&
          action.target?.stableAttributes.name === "ngap_code",
      );
      const finalButton = session.actions.find(
        (action) => action.target?.accessibleName === "Ajouter un code NGAP",
      );

      expect(firstLink?.pageContextId).toBe(
        contextByPath.get(consultationsPath)?.id,
      );
      expect(iconClick).toMatchObject({
        pageContextId: contextByPath.get(staysPath)?.id,
        beforeState: {
          pageContextId: contextByPath.get(staysPath)?.id,
          pathname: staysPath,
        },
        target: {
          clickEvidence: {
            rawTarget: {
              tag: "img",
              title: "Ouvrir le codage NGAP",
              src: `${fixtureOrigin}/fixture/assets/codage-ngap.png`,
            },
            normalizedClickable: { tag: "a" },
            canonicalHref: `${fixtureOrigin}${codingPath}`,
            onclick: "return true",
            form: {
              name: "stay-row-actions",
              id: "stay-row-actions",
              action: `${fixtureOrigin}${staysPath}`,
            },
            table: {
              rowIndex: 1,
              columnIndex: 2,
              headers: ["Séjour", "Unité", "Action"],
              rowText: ["Séjour synthétique Alpha", "Étage témoin"],
            },
          },
        },
      });
      expect(iconClick?.target?.accessibleName).toBeUndefined();
      expect(iconClick?.target?.captureValidation.exactTargetConnected).toBe(
        true,
      );
      expect(selection).toMatchObject({
        pageContextId: contextByPath.get(codingPath)?.id,
        action: "select",
        value: {
          kind: "literal",
          value: "214",
          persistence: "workflow",
        },
        selectionGesture: {
          keys: ["c", "Enter"],
          nativeChangeObserved: true,
          replayKeyboardEvents: false,
        },
      });
      expect(
        session.actions.filter(
          (action) =>
            action.target?.fingerprint === selection?.target?.fingerprint,
        ),
      ).toEqual([selection]);
      expect(finalButton?.pageContextId).toBe(
        contextByPath.get(codingPath)?.id,
      );

      const provider = new EvidenceAwareMockProvider();
      const { workflow } = await compileDemonstration({
        session,
        graph: browser.graph,
        localValues: recorder.localValues,
        provider,
      });
      expect(provider.payload?.demonstration.pages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: contextByPath.get(staysPath)?.id,
            pageId: contextByPath.get(staysPath)?.pageId,
            pathname: staysPath,
          }),
        ]),
      );
      const immutableSteps = workflow.steps.filter((step) => !step.inferred);
      expect(
        immutableSteps.map((step) => ({
          sourceActionId: step.sourceActionId,
          action: step.action,
        })),
      ).toEqual(
        session.actions.map((action) => ({
          sourceActionId: action.id,
          action: action.action,
        })),
      );
      const iconStep = immutableSteps.find(
        (step) => step.sourceActionId === iconClick?.id,
      );
      const selectedIconLocator = iconStep?.locatorCandidates.find(
        (candidate) => candidate.id === iconStep.selectedLocatorId,
      );
      expect(selectedIconLocator).toMatchObject({
        strategy: "row-icon-context",
        matchCount: 1,
        visibleCount: 1,
        enabledCount: 1,
        typeCompatibleCount: 1,
      });
      expect(selectedIconLocator?.explanation).toContain(
        "capture-time evidence",
      );
      expect(iconStep?.semanticEnrichment).toMatchObject({
        semanticTarget:
          "Anonymous coding link identified by row and icon evidence.",
        confidence: 0.99,
      });
      const selectStep = immutableSteps.find(
        (step) => step.sourceActionId === selection?.id,
      );
      expect(selectStep).toMatchObject({
        action: "select",
        value: { kind: "literal", value: "214" },
      });
      expect(
        immutableSteps.filter(
          (step) =>
            step.action === "keyboard" &&
            ["c", "Enter"].includes(step.key ?? ""),
        ),
      ).toEqual([]);
      expect(
        workflow.steps.some(
          (step) => step.target?.accessibleName === "Ajouter un code NGAP",
        ),
      ).toBe(true);

      for (let run = 0; run < 2; run += 1) {
        await browser.navigate(`${fixtureOrigin}${consultationsPath}`);
        const telemetry = await new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: {},
          mode: "local",
        }).run();
        expect(telemetry.state, telemetry.error).toBe("Passed");
        expect(telemetry.llmCalls).toBe(0);
        expect(telemetry.openAIRequests).toBe(0);
        await expect(
          page.getByText("Code NGAP 214 ajouté.", { exact: true }),
        ).toBeVisible();
      }
    },
  );
});

test("anonymous <i> is resolved by its row and column among eight canonical links", async () => {
  const consultationsPath = "/fixture/anonymous-icon/consultations.cgi";
  const staysPath = "/fixture/anonymous-icon/sejours.cgi";
  const codingPath = "/fixture/anonymous-icon/codage_etage.cgi";

  await withManagedBrowser(
    `${fixtureOrigin}${consultationsPath}`,
    async ({ browser, page, recorder }) => {
      await recorder.start();

      await page
        .getByRole("link", { name: "Ouvrir les séjours", exact: true })
        .click();
      await page.waitForURL(`**${staysPath}`);
      await expect(page.locator(`a[href^="${codingPath}"]`)).toHaveCount(8);
      await page
        .locator("tbody tr")
        .nth(2)
        .locator("td")
        .nth(10)
        .locator("i")
        .click();
      await page.waitForURL(`**${codingPath}?stay=3`);

      const select = page.getByLabel("Acte NGAP", { exact: true });
      await select.selectOption("214");
      await page
        .getByRole("button", {
          name: "Ajouter un code NGAP",
          exact: true,
        })
        .click();
      await expect(
        page.getByText("Code NGAP 214 ajouté.", { exact: true }),
      ).toBeVisible();

      const session = await recorder.stop();
      const iconClick = session.actions.find(
        (action) =>
          action.target?.clickEvidence?.canonicalHref ===
          `${fixtureOrigin}${codingPath}`,
      );
      expect(iconClick).toMatchObject({
        action: "click",
        beforeState: { pathname: staysPath },
        target: {
          descriptor: { rawTargetPromoted: true },
          clickEvidence: {
            rawTarget: { tag: "i" },
            normalizedClickable: { tag: "a", role: "link" },
            icon: { tag: "i" },
            canonicalHref: `${fixtureOrigin}${codingPath}`,
            table: {
              rowIndex: 3,
              columnIndex: 10,
            },
            captureValidation: {
              canonicalHrefMatchCount: 8,
              iconMatchCount: 0,
              rowIconMatchCount: 1,
            },
          },
        },
      });
      expect(iconClick?.target?.clickEvidence?.icon?.alt).toBeUndefined();
      expect(iconClick?.target?.clickEvidence?.icon?.title).toBeUndefined();
      expect(iconClick?.target?.clickEvidence?.icon?.src).toBeUndefined();

      const { workflow } = await compileDemonstration({
        session,
        graph: browser.graph,
        localValues: recorder.localValues,
        provider: new MockGeneralizationProvider(),
      });
      const iconStep = workflow.steps.find(
        (step) => step.sourceActionId === iconClick?.id,
      );
      expect(
        iconStep?.locatorCandidates.find(
          (candidate) => candidate.id === iconStep.selectedLocatorId,
        ),
      ).toMatchObject({
        strategy: "row-icon-context",
        matchCount: 1,
        visibleCount: 1,
        enabledCount: 1,
        typeCompatibleCount: 1,
      });
      expect(
        iconStep?.locatorCandidates.find(
          (candidate) => candidate.strategy === "same-row-column",
        ),
      ).toMatchObject({
        rule: {
          strategy: "same-row-column",
          rowIndex: 3,
          columnIndex: 10,
          iconTag: "i",
        },
        unique: true,
      });

      for (let run = 0; run < 2; run += 1) {
        const runtimeWorkflow =
          run === 0
            ? {
                ...workflow,
                steps: workflow.steps.map((step) => ({
                  ...step,
                  locatorCandidates: step.locatorCandidates.filter(
                    (candidate) => candidate.strategy !== "same-row-column",
                  ),
                })),
              }
            : workflow;
        await browser.navigate(
          `${fixtureOrigin}${consultationsPath}?variant=${run === 0 ? "runtime" : "coordinate"}`,
        );
        const telemetry = await new DeterministicRuntime({
          context: browser.context,
          workflow: runtimeWorkflow,
          variables: {},
          mode: "local",
        }).run();
        expect(telemetry.state, telemetry.error).toBe("Passed");
        expect(telemetry.llmCalls).toBe(0);
        expect(telemetry.openAIRequests).toBe(0);
        await expect(
          page.getByText("Code NGAP 214 ajouté.", { exact: true }),
        ).toBeVisible();
      }
    },
  );
});
