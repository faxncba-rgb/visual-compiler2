import { expect, test } from "@playwright/test";
import { DeterministicRuntime } from "../../packages/deterministic-runtime/src";
import { compilePrimary, fixtureOrigin, withManagedBrowser } from "./helpers";

test("records and replays accepted and dismissed dialogs", async () => {
  await withManagedBrowser(
    `${fixtureOrigin}/fixture/dialogs`,
    async ({ browser, page, recorder }) => {
      await recorder.start();
      await page.getByRole("button", { name: "Open alert" }).click();
      await page.getByText("Alert accepted.", { exact: true }).waitFor();
      recorder.setNextDialogResponse("dismissed");
      await page.getByRole("button", { name: "Open confirm" }).click();
      await page
        .getByText("Confirm dismissed as demonstrated.", { exact: true })
        .waitFor();
      const session = await recorder.stop();
      const dialogs = session.actions.filter(
        (action) => action.action === "dialog",
      );
      expect(dialogs).toEqual([
        expect.objectContaining({
          dialog: expect.objectContaining({
            type: "alert",
            response: "accepted",
          }),
        }),
        expect.objectContaining({
          dialog: expect.objectContaining({
            type: "confirm",
            response: "dismissed",
          }),
        }),
      ]);
      const workflow = await compilePrimary({
        browser,
        session,
        values: recorder.localValues,
      });
      await browser.navigate(`${fixtureOrigin}/fixture/dialogs`);
      const telemetry = await new DeterministicRuntime({
        context: browser.context,
        workflow,
        variables: {},
        mode: "local",
      }).run();
      expect(telemetry.state, telemetry.error).toBe("Passed");
      await expect(
        page.getByText("Confirm dismissed as demonstrated.", { exact: true }),
      ).toBeVisible();
    },
  );
});

test("Page Context Graph keeps a stable tab ID and distinct query-free document IDs", async () => {
  await withManagedBrowser(
    `${fixtureOrigin}/fixture?variant=A&patient=SHOULD_NOT_PERSIST`,
    async ({ browser }) => {
      const before = browser.graph.data();
      const rootId = before.rootId;
      const fixtureDocument = before.nodes.find(
        (node) => node.pathname === "/fixture" && node.status === "active",
      );
      await browser.navigate(
        `${fixtureOrigin}/fixture/popup-workflow?patient=SHOULD_NOT_PERSIST`,
      );
      const after = browser.graph.data();
      expect(after.rootId).toBe(rootId);
      const popupWorkflowDocument = after.nodes.find(
        (node) =>
          node.pathname === "/fixture/popup-workflow" &&
          node.status === "active",
      );
      expect(fixtureDocument).toMatchObject({
        origin: fixtureOrigin,
        pathname: "/fixture",
      });
      expect(popupWorkflowDocument).toMatchObject({
        origin: fixtureOrigin,
        pathname: "/fixture/popup-workflow",
        pageId: fixtureDocument?.pageId,
      });
      expect(popupWorkflowDocument?.id).not.toBe(fixtureDocument?.id);
      expect(
        after.nodes.find((node) => node.id === fixtureDocument?.id)?.status,
      ).toBe("replaced");
      expect(after.edges).toContainEqual({
        from: fixtureDocument?.id,
        to: popupWorkflowDocument?.id,
        relation: "navigated",
      });
      expect(JSON.stringify(after)).not.toContain("patient");
      expect(JSON.stringify(after)).not.toContain("SHOULD_NOT_PERSIST");
    },
  );
});
