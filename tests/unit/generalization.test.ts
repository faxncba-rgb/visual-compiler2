import { describe, expect, it } from "vitest";
import {
  AiGeneralizationOutputSchema,
  COMPILE_MODEL,
  MockGeneralizationProvider,
  OpenAiCompileProvider,
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
    expect(payload.exclusions.arbitraryFormValues).toBe(true);
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
    expect(result.actionPlan.map((action) => action.actionId)).toEqual(
      payload.demonstration.actions.map((action) => action.id),
    );
  });

  it("rejects invalid model output and target substitution", () => {
    expect(() =>
      AiGeneralizationOutputSchema.parse({
        schemaVersion: "1.0.0",
        summary: "unsafe",
        preserveDemonstratedTargets: false,
        actionPlan: [],
        loops: [],
      }),
    ).toThrow();
  });

  it("uses GPT-5.6 Responses structured output exactly once without an SDK", async () => {
    const payload = buildAiPayload(session(), "", {});
    let request:
      | {
          url: string;
          init?: RequestInit;
        }
      | undefined;
    const semanticIr = await new MockGeneralizationProvider().generalize(
      payload,
    );
    const provider = new OpenAiCompileProvider(
      "test-only-key",
      async (url, init) => {
        request = { url, ...(init ? { init } : {}) };
        return new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify(semanticIr),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      },
    );
    expect(await provider.generalize(payload)).toEqual(semanticIr);
    expect(request?.url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(request?.init?.body)) as {
      model: string;
      store: boolean;
      reasoning: { effort: string };
      text: { format: { type: string; strict: boolean } };
    };
    expect(body).toMatchObject({
      model: COMPILE_MODEL,
      store: false,
      reasoning: { effort: "medium" },
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(String(request?.init?.body)).not.toContain("test-only-key");
  });
});
