import { describe, expect, it } from "vitest";
import {
  applyRuntimeValueTransforms,
  assertNoLocalValuesInSession,
  resolveValueReference,
  runtimeGuardMatches,
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

  it("extracts the first eligible locale number and excludes 53,90", () => {
    const result = applyRuntimeValueTransforms(
      "Forfait 53,90 puis montant 1 250,50 à traiter.",
      [
        {
          type: "number-in-range",
          minimum: 50,
          maximum: 5000,
          excludedNumbers: [53.9],
          occurrence: "first",
        },
      ],
    );
    expect(result.value).toBe("1250,50");
    expect(result.audit).toEqual({
      numericCandidates: 2,
      excludedNumericCandidates: 1,
      eligibleNumberFound: true,
    });
  });

  it("matches VIR as a case-insensitive whole token", () => {
    const guard = {
      type: "runtime-variable-contains" as const,
      variableName: "copied_text_1",
      keyword: "VIR",
      caseSensitive: false,
      wholeWord: true,
    };
    expect(
      runtimeGuardMatches(
        guard,
        new Map([["copied_text_1", "Règlement vir confirmé"]]),
      ),
    ).toBe(true);
    expect(
      runtimeGuardMatches(
        guard,
        new Map([["copied_text_1", "Virement standard"]]),
      ),
    ).toBe(false);
  });
});
