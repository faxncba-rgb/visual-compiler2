import { describe, expect, it } from "vitest";
import {
  assertNoLocalValuesInSession,
  resolveValueReference,
  valuesForAiInstruction,
} from "../../packages/workflow-variables/src";
import { session } from "../helpers/factories";

describe("local workflow variables", () => {
  it("resolves values locally", () => {
    expect(
      resolveValueReference("{{consultation_text}}", undefined, {
        consultation_text: "Synthetic local content",
      }),
    ).toBe("Synthetic local content");
  });

  it("does not include local variables in AI-intentional values by default", () => {
    expect(
      valuesForAiInstruction(session().variables, {
        consultation_text: "Synthetic local content",
      }),
    ).toEqual({});
  });

  it("rejects a demonstration artifact containing a separated local value", () => {
    expect(() =>
      assertNoLocalValuesInSession(session(), {
        consultation_text: "Synthetic local content",
      }),
    ).not.toThrow();
    const contaminated = session();
    contaminated.actions[0]!.name = "Synthetic local content";
    expect(() =>
      assertNoLocalValuesInSession(contaminated, {
        consultation_text: "Synthetic local content",
      }),
    ).toThrow("must remain separate");
  });
});
