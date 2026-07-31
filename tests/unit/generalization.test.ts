import { describe, expect, it } from "vitest";
import {
  AiGeneralizationOutputSchema,
  COMPILE_MODEL,
  LIVE_COMPILE_TIMEOUT_MS,
  MockGeneralizationProvider,
  OpenAiCompileProvider,
  buildAiPayload,
  compileDemonstration,
  deriveDeterministicRuntimePolicy,
  validateAndNormalizeSemanticIr,
} from "../../packages/generalization-compiler/src";
import { session } from "../helpers/factories";
import { target } from "../helpers/factories";

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
    expect(result.enrichments.map((action) => action.sourceActionId)).toEqual(
      payload.demonstration.actions.map((action) => action.id),
    );
  });

  it("rejects invalid model output and target substitution", () => {
    expect(() =>
      AiGeneralizationOutputSchema.parse({
        schemaVersion: "2.0.0",
        summary: "unsafe",
        enrichments: [
          {
            sourceActionId: "invented",
            intention: "replace",
            semanticTarget: "different",
            confidence: 2,
          },
        ],
        inferredActions: [],
        loops: [],
      }),
    ).toThrow();
  });

  it("keeps immutable local actions while dropping orphan GPT enrichments and inferences", async () => {
    const demonstration = session();
    const provider = new MockGeneralizationProvider();
    const output = AiGeneralizationOutputSchema.parse(
      await provider.generalize(
        buildAiPayload(demonstration, "Repeat each demonstrated action.", {}),
      ),
    );
    output.enrichments.push(
      {
        ...output.enrichments[0]!,
        sourceActionId: "invented-action",
      },
      {
        ...output.enrichments[0]!,
        intention: "Duplicate must not replace the first enrichment.",
      },
    );
    output.inferredActions.push({
      action: "navigation",
      name: "Ungrounded navigation",
      position: {
        relativeToSourceActionId: "invented-action",
        placement: "after",
      },
      pageContextId: "invented-document",
      evidenceRefs: ["invented-evidence"],
      confidence: 0.99,
      justification: "The model invented every reference.",
      asPostcondition: false,
    });
    output.loops[0]!.templateActionIds.push("invented-action");
    output.loops.push({
      ...output.loops[0]!,
      templateActionIds: ["invented-action"],
    });

    const normalized = validateAndNormalizeSemanticIr(output, demonstration);
    expect(
      normalized.output.enrichments.map(
        (enrichment) => enrichment.sourceActionId,
      ),
    ).toEqual(demonstration.actions.map((action) => action.id));
    expect(normalized.output.inferredActions).toEqual([]);
    expect(normalized.output.loops).toHaveLength(1);
    expect(normalized.output.loops[0]?.templateActionIds).toEqual([
      "action-fill",
    ]);
    expect(normalized.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      [
        "GPT_ORPHAN_ENRICHMENT_DROPPED",
        "GPT_DUPLICATE_ENRICHMENT_DROPPED",
        "GPT_UNGROUNDED_INFERRED_ACTION_DROPPED",
        "GPT_UNKNOWN_LOOP_REFERENCE_DROPPED",
        "GPT_UNGROUNDED_LOOP_DROPPED",
      ],
    );
  });

  it("compiles successfully when GPT returns an otherwise valid orphan enrichment", async () => {
    const demonstration = session();
    const mock = new MockGeneralizationProvider();
    const provider = {
      mode: mock.mode,
      model: "gpt-5.6" as const,
      async generalize(payload: Parameters<typeof mock.generalize>[0]) {
        const output = AiGeneralizationOutputSchema.parse(
          await mock.generalize(payload),
        );
        output.enrichments.push({
          ...output.enrichments[0]!,
          sourceActionId: "invented-action",
        });
        return output;
      },
    };
    const { workflow } = await compileDemonstration({
      session: demonstration,
      graph: {
        resolveLiveTargetRoot: async () => ({
          originalDomNodeReplaced: false,
          semanticEquivalentFound: true,
        }),
      } as never,
      localValues: {},
      provider,
    });

    expect(
      workflow.steps
        .filter((step) => !step.inferred)
        .map((step) => step.sourceActionId),
    ).toEqual(demonstration.actions.map((action) => action.id));
    expect(workflow.compilationMetadata.diagnostics).toContainEqual({
      level: "warning",
      code: "GPT_ORPHAN_ENRICHMENT_DROPPED",
      message:
        "1 GPT enrichment(s) referenced no demonstrated action and were ignored.",
    });
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
    expect(LIVE_COMPILE_TIMEOUT_MS).toBe(240_000);
    expect(request?.init?.signal?.aborted).toBe(false);
    expect(String(request?.init?.body)).not.toContain("test-only-key");
  });

  it("derives immutable local dataflow, VIR guard and a 20-run bound from explicit instructions", () => {
    const demo = session();
    demo.actions = [
      {
        id: "extract-source",
        pageContextId: "page-main",
        action: "extract",
        name: "copied source zone",
        target: target({
          fingerprint: "source-zone",
          tag: "span",
          role: undefined,
          editable: false,
        }),
        outputVariable: "copied_text_1",
        observedEffects: [],
        timestampOffsetMs: 100,
        optional: false,
      },
      {
        id: "fill-dho",
        pageContextId: "page-main",
        action: "fill",
        name: "filled first DHO",
        target: target({
          fingerprint: "dho",
          stableAttributes: { name: "dho_1" },
        }),
        value: {
          kind: "literal",
          value: "200",
          persistence: "workflow",
        },
        observedEffects: [],
        timestampOffsetMs: 200,
        optional: false,
      },
      {
        id: "check-entente",
        pageContextId: "page-main",
        action: "check",
        name: "checked first Entente Directe",
        target: target({
          fingerprint: "entente",
          inputType: "checkbox",
          role: "checkbox",
          stableAttributes: { name: "entente_directe_tout" },
        }),
        observedEffects: [],
        timestampOffsetMs: 300,
        optional: false,
      },
    ];
    demo.variables = [
      {
        id: "runtime-copy",
        name: "copied_text_1",
        valueType: "string",
        sourceActionId: "extract-source",
        privacy: "runtime-derived",
        required: true,
      },
    ];
    const policy = deriveDeterministicRuntimePolicy(
      demo,
      "Rechercher le premier chiffre entre 50 et 5000, exclure 53,90. Si le mot-clé VIR est détecté, cocher la première case Entente Directe. Répéter 20 fois.",
    );
    expect(policy.repeatCount).toBe(20);
    expect(policy.valueBindings.get("fill-dho")).toEqual({
      variableName: "copied_text_1",
      transforms: [
        {
          type: "number-in-range",
          minimum: 50,
          maximum: 5000,
          excludedNumbers: [53.9],
          occurrence: "first",
        },
      ],
    });
    expect(policy.executionGuards.get("check-entente")).toMatchObject({
      variableName: "copied_text_1",
      keyword: "VIR",
    });
  });
});
