import { describe, expect, it } from "vitest";
import {
  renderEditorFrame,
  renderFixture,
  renderPopupAction,
  renderPopupWorkflow,
} from "../../apps/synthetic-dpi/src/fixture";

describe("synthetic legacy DPI", () => {
  it.each(["A", "B"])(
    "contains Date, Heure, exact consultation editor, legacy save, and outcomes in variant %s",
    (variant) => {
      const html = renderFixture(
        new URL(`http://127.0.0.1:4273/fixture?variant=${variant}`),
      );
      expect(html).toContain(">Date</label>");
      expect(html).toContain(">Heure</label>");
      expect(html).toContain(">Texte de consultation</label>");
      expect(html).toContain('data-vc-action="save-consultation"');
      expect(html).toContain("onclick=");
      expect(html).toContain("window.open('/fixture/validation");
      expect(html).toContain("data-vc-outcome");
    },
  );

  it("supports contenteditable, iframe, and legacy facade strategies", () => {
    for (const editor of ["contenteditable", "iframe", "facade"]) {
      const html = renderFixture(
        new URL(`http://127.0.0.1:4273/fixture?variant=A&editor=${editor}`),
      );
      expect(html).toContain(`data-editor="${editor}"`);
    }
    expect(renderEditorFrame()).toContain('data-vc-editor="iframe"');
  });

  it("models an action-inside-popup workflow", () => {
    expect(renderPopupWorkflow()).toContain("/fixture/popup-action");
    expect(renderPopupAction()).toContain("Valider et fermer");
    expect(renderPopupAction()).toContain("__popupActionDone");
  });
});
