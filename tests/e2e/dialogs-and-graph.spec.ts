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

test("Page Context Graph keeps stable IDs while canonical navigation drops queries", async () => {
  await withManagedBrowser(
    `${fixtureOrigin}/fixture?variant=A&patient=SHOULD_NOT_PERSIST`,
    async ({ browser }) => {
      const before = browser.graph.data();
      const rootId = before.rootId;
      await browser.navigate(
        `${fixtureOrigin}/fixture/popup-workflow?patient=SHOULD_NOT_PERSIST`,
      );
      const after = browser.graph.data();
      expect(after.rootId).toBe(rootId);
      expect(after.nodes.find((node) => node.id === rootId)).toMatchObject({
        origin: fixtureOrigin,
        pathname: "/fixture/popup-workflow",
      });
      expect(JSON.stringify(after)).not.toContain("patient");
      expect(JSON.stringify(after)).not.toContain("SHOULD_NOT_PERSIST");
    },
  );
});
