import { expect, test } from "@playwright/test";
import { fixtureOrigin, withManagedBrowser } from "./helpers";

test("records temporal typing, meaningful keys, checkbox, dropdown and menu actions", async () => {
  await withManagedBrowser(
    `${fixtureOrigin}/fixture/controls`,
    async ({ page, recorder }) => {
      await recorder.start();

      const note = page.getByLabel("Synthetic note", { exact: true });
      await note.click();
      await note.pressSequentially("ordinary typing");
      await page.waitForTimeout(380);
      await note.press("Tab");
      await page.getByLabel("Enable tracking", { exact: true }).check();
      await page.getByLabel("Priority", { exact: true }).selectOption("high");
      const menuTrigger = page.getByRole("button", {
        name: "Choose category",
        exact: true,
      });
      await menuTrigger.press("ArrowDown");
      await menuTrigger.locator("span").click();
      await page
        .getByRole("menuitem", { name: "Review", exact: true })
        .locator("span")
        .click();
      await page
        .getByText("Category review selected.", { exact: true })
        .waitFor();

      const session = await recorder.stop();
      const humanActions = session.actions.filter((action) =>
        [
          "click",
          "double-click",
          "fill",
          "select",
          "check",
          "uncheck",
          "keyboard",
          "submit",
        ].includes(action.action),
      );

      expect(session.actions.map((action) => action.sequence)).toEqual(
        session.actions.map((_, index) => index + 1),
      );
      expect(session.actions.map((action) => action.timestampOffsetMs)).toEqual(
        [...session.actions]
          .sort(
            (left, right) => left.timestampOffsetMs - right.timestampOffsetMs,
          )
          .map((action) => action.timestampOffsetMs),
      );
      expect(
        humanActions.filter((action) => action.action === "fill"),
      ).toHaveLength(1);
      expect(humanActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: "keyboard", key: "Tab" }),
          expect.objectContaining({ action: "keyboard", key: "ArrowDown" }),
          expect.objectContaining({
            action: "check",
            target: expect.objectContaining({
              checked: true,
              associatedLabel: "Enable tracking",
            }),
          }),
          expect.objectContaining({
            action: "select",
            target: expect.objectContaining({
              selected: true,
              associatedLabel: "Priority",
            }),
          }),
          expect.objectContaining({
            action: "click",
            target: expect.objectContaining({
              role: "button",
              accessibleName: "Choose category",
              descriptor: expect.objectContaining({
                rawTargetPromoted: true,
              }),
            }),
          }),
          expect.objectContaining({
            action: "click",
            target: expect.objectContaining({
              role: "menuitem",
              accessibleName: "Review",
              descriptor: expect.objectContaining({
                rawTargetPromoted: true,
              }),
            }),
          }),
        ]),
      );
      expect(session.outcomeVerification).toBe("VERIFIED");
    },
  );
});
