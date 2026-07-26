import { describe, expect, it } from "vitest";
import {
  AiGeneralizationOutputSchema,
  MockGeneralizationProvider,
  buildAiPayload,
} from "../../packages/generalization-compiler/src";
import { session } from "../helpers/factories";

describe("strict AI generalization boundary", () => {
  it("builds a query-free, value-free payload preview", () => {
    const demo = session();
    demo.pages[0]!.pathname = "/fixture";
    const payload = buildAiPayload(
      demo,
      "Repeat on each following eligible row.",
      { consultation_text: "SYNTHETIC MEDICAL-LIKE TEXT MUST STAY LOCAL" },
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("SYNTHETIC MEDICAL-LIKE");
    expect(serialized).not.toContain("?");
    expect(payload.intentionalValues).toEqual({});
  });

  it("labels and validates mocked bounded output", async () => {
    const provider = new MockGeneralizationProvider();
    const payload = buildAiPayload(
      session(),
      "Repeat on each following eligible row.",
      { consultation_text: "UNIQUE_LOCAL_VALUE_NOT_IN_IR" },
    );
    const result = AiGeneralizationOutputSchema.parse(
      await provider.generalize(payload),
    );
    expect(provider.mode).toBe("mock-ai-generalization");
    expect(result.loops[0]).toMatchObject({
      maximumIterations: 100,
      maximumDurationMs: 600_000,
      duplicateItemProtection: true,
    });
  });

  it("rejects invalid model output and target substitution", () => {
    expect(() =>
      AiGeneralizationOutputSchema.parse({
        summary: "unsafe",
        preserveDemonstratedTargets: false,
        loops: [],
      }),
    ).toThrow();
  });
});
