import { describe, expect, it } from "vitest";
import {
  CompiledLoopSchema,
  DemonstrationSessionSchema,
  DemonstratedTargetDescriptorSchema,
} from "../../packages/demonstration-ir/src";
import { loop, session, target } from "../helpers/factories";

describe("Demonstration IR", () => {
  it("validates a parameterized demonstration with no raw local value", () => {
    const parsed = DemonstrationSessionSchema.parse(session());
    expect(parsed.actions[0]?.valueRef).toBe("{{consultation_text}}");
    expect(JSON.stringify(parsed)).not.toContain("Synthetic private value");
  });

  it("requires bounded loop stop conditions and duplicate protection", () => {
    expect(CompiledLoopSchema.parse(loop()).maximumIterations).toBe(100);
    expect(() =>
      CompiledLoopSchema.parse({
        ...loop(),
        stoppingConditions: [{ type: "no-next-eligible-item" }],
      }),
    ).toThrow();
    expect(() =>
      CompiledLoopSchema.parse({
        ...loop(),
        maximumIterations: 0,
      }),
    ).toThrow();
  });

  it("migrates demonstrations without outcome evidence as UNVERIFIED", () => {
    const legacy = session() as unknown as Record<string, unknown>;
    delete legacy.outcomeCandidates;
    delete legacy.outcomeVerification;
    const parsed = DemonstrationSessionSchema.parse(legacy);
    expect(parsed.outcomeCandidates).toEqual([]);
    expect(parsed.outcomeVerification).toBe("UNVERIFIED");
    expect(parsed.actions.some((action) => action.target)).toBe(true);
  });

  it("keeps mutable DOM and consultation-history evidence out of the target descriptor", () => {
    const parsed = DemonstratedTargetDescriptorSchema.parse({
      ...target().descriptor!,
      currentValue: "MUST-NOT-BE-PRESERVED",
      generatedId: "generated-123",
      generatedClass: "render-456",
      consultationHistory: ["saved row"],
      pageInstanceId: "page-instance-1",
      recordingSessionNodeId: "node-1",
      timestamp: "2026-07-26T00:00:00.000Z",
    });
    expect(parsed).toMatchObject({
      controlFamily: "multiline-text",
      multiline: true,
      editable: true,
    });
    expect(JSON.stringify(parsed)).not.toMatch(
      /MUST-NOT-BE-PRESERVED|generated-123|render-456|saved row|page-instance|node-1|2026-07-26/,
    );
  });
});
