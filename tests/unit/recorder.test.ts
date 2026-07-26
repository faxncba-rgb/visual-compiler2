import { describe, expect, it } from "vitest";
import type { Frame } from "playwright";
import {
  deduplicateAction,
  shouldExcludeFrame,
  variableNameForTarget,
} from "../../packages/demonstration-recorder/src";
import type { RecordedAction } from "../../packages/demonstration-ir/src";
import { target } from "../helpers/factories";

function action(overrides: Partial<RecordedAction> = {}): RecordedAction {
  return {
    id: "action-1",
    pageContextId: "page-main",
    action: "click",
    name: "clicked consultation",
    target: target(),
    observedEffects: [],
    timestampOffsetMs: 100,
    optional: false,
    ...overrides,
  };
}

describe("high-level recorder", () => {
  it("deduplicates one human action instead of pointer-level noise", () => {
    const actions = [action()];
    const result = deduplicateAction(
      actions,
      action({ id: "action-2", timestampOffsetMs: 140 }),
    );
    expect(result).toBe("replaced");
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("action-2");
  });

  it("keeps distinct click and fill actions", () => {
    const actions = [action()];
    deduplicateAction(
      actions,
      action({
        id: "action-2",
        action: "fill",
        valueRef: "{{consultation_text}}",
      }),
    );
    expect(actions.map((entry) => entry.action)).toEqual(["click", "fill"]);
  });

  it("drops the duplicate change event emitted after a filled editor loses focus", () => {
    const fill = action({
      id: "fill-1",
      action: "fill",
      valueRef: "{{consultation_text}}",
      timestampOffsetMs: 400,
    });
    const actions = [
      fill,
      action({
        id: "save-click",
        pageContextId: "page-main",
        timestampOffsetMs: 510,
      }),
    ];
    const result = deduplicateAction(
      actions,
      action({
        id: "fill-change",
        action: "fill",
        valueRef: "{{consultation_text}}",
        timestampOffsetMs: 510,
      }),
    );
    expect(result).toBe("replaced");
    expect(actions).toHaveLength(2);
    expect(actions[0]?.id).toBe("fill-1");
  });

  it("parameterizes consultation, date, time, and option fields", () => {
    expect(variableNameForTarget(target())).toBe("consultation_text");
    expect(
      variableNameForTarget(
        target({
          associatedLabel: "Date",
          accessibleName: "Date",
          stableAttributes: { name: "date_consultation" },
        }),
      ),
    ).toBe("date");
    expect(
      variableNameForTarget(
        target({
          associatedLabel: "Heure",
          accessibleName: "Heure",
          stableAttributes: { name: "heure_consultation" },
        }),
      ),
    ).toBe("time");
    expect(
      variableNameForTarget(
        target({
          associatedLabel: "Décision synthétique",
          accessibleName: "Décision synthétique",
          stableAttributes: { name: "decision" },
        }),
      ),
    ).toBe("selected_option");
  });

  it("excludes cross-origin frames as opaque contexts", () => {
    const page = {
      url: () => "http://127.0.0.1:4273/fixture",
      mainFrame: () => main,
    };
    const main = { page: () => page, url: page.url } as unknown as Frame;
    const cross = {
      page: () => page,
      url: () => "http://localhost:4273/fixture/cross-origin",
    } as unknown as Frame;
    expect(shouldExcludeFrame(main)).toBe(false);
    expect(shouldExcludeFrame(cross)).toBe(true);
  });
});
