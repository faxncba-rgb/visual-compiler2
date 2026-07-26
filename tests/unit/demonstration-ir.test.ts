import { describe, expect, it } from "vitest";
import {
  CompiledLoopSchema,
  DemonstrationSessionSchema,
} from "../../packages/demonstration-ir/src";
import { loop, session } from "../helpers/factories";

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
});
