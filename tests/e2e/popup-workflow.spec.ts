import { expect, test } from "@playwright/test";
import { DeterministicRuntime } from "../../packages/deterministic-runtime/src";
import { compilePrimary, fixtureOrigin, withManagedBrowser } from "./helpers";

test("records and replays an action inside a popup, closure, and return to opener", async () => {
  await withManagedBrowser(
    `${fixtureOrigin}/fixture/popup-workflow`,
    async ({ browser, page, recorder }) => {
      await recorder.start();
      const popupPromise = page.waitForEvent("popup");
      await page
        .getByRole("button", { name: "Ouvrir la validation détaillée" })
        .click();
      const popup = await popupPromise;
      await expect
        .poll(() =>
          popup.evaluate(() => ({
            installed: Boolean(
              (
                globalThis as typeof globalThis & {
                  __vc2RecorderInstalled?: boolean;
                }
              ).__vc2RecorderInstalled,
            ),
            binding: typeof (
              globalThis as typeof globalThis & {
                __vc2Record?: unknown;
              }
            ).__vc2Record,
          })),
        )
        .toEqual({ installed: true, binding: "function" });
      const popupLiteral = "SYNTHETIC-POPUP-LITERAL";
      await popup
        .getByLabel("Note synthétique popup", { exact: true })
        .fill(popupLiteral);
      await popup.getByLabel("Décision synthétique").selectOption("A");
      await expect
        .poll(() => recorder.session.actions.map((action) => action.action))
        .toContain("select");
      expect(recorder.status().bindingErrors).toEqual([]);
      await popup.getByRole("button", { name: "Valider et fermer" }).click();
      if (!popup.isClosed()) {
        await popup.waitForEvent("close");
      }
      await page.getByText("Option A validée dans la popup.").waitFor();
      const session = await recorder.stop();

      expect(session.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: "popup-open" }),
          expect.objectContaining({
            action: "fill",
            pageContextId: expect.stringMatching(/^page-/),
            value: {
              kind: "literal",
              value: popupLiteral,
              persistence: "workflow",
            },
          }),
          expect.objectContaining({
            action: "select",
            pageContextId: expect.stringMatching(/^page-/),
          }),
          expect.objectContaining({ action: "popup-close" }),
        ]),
      );
      expect(session.outcomeCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "success-marker",
            observed: true,
            selected: true,
          }),
        ]),
      );
      const popupNode = session.pages.find((node) => node.role === "popup");
      expect(popupNode).toMatchObject({
        parentId: expect.any(String),
        pathname: "/fixture/popup-action",
        status: "closed",
      });

      const values = recorder.localValues;
      const workflow = await compilePrimary({ browser, session, values });
      await browser.navigate(`${fixtureOrigin}/fixture/popup-workflow`);
      const telemetry = await new DeterministicRuntime({
        context: browser.context,
        workflow,
        variables: values,
        mode: "local",
      }).run();
      expect(telemetry.state).toBe("Passed");
      expect(telemetry.llmCalls).toBe(0);
      expect(telemetry.openAIRequests).toBe(0);
      await expect(
        page.getByText("Option A validée dans la popup."),
      ).toBeVisible();
      expect(await page.getAttribute("body", "data-vc-popup-note")).toBe(
        popupLiteral,
      );
      expect(page.isClosed()).toBe(false);
      expect(
        browser.context.pages().filter((candidate) => !candidate.isClosed()),
      ).toEqual([page]);
    },
  );
});
