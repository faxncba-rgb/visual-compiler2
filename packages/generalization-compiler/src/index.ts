import { z } from "zod";
import {
  CompiledWorkflowSchema,
  DemonstrationSessionSchema,
  type ApplicationOutcome,
  type CompiledLoop,
  type CompiledStep,
  type CompiledWorkflow,
  type DemonstrationSession,
} from "../../demonstration-ir/src";
import type { PageContextGraph } from "../../page-context-graph/src";
import {
  selectDemonstratedLocator,
  validateCapturedLocatorCandidates,
  validateLocatorCandidates,
} from "../../locator-engine/src";
import {
  assertNoLocalValuesInSession,
  valuesForAiInstruction,
  type LocalVariableValues,
} from "../../workflow-variables/src";
import { createId, sha256 } from "../../shared/src";

export const PROMPT_VERSION = "demonstration-generalization-v1";

export const AiGeneralizationOutputSchema = z.object({
  summary: z.string(),
  preserveDemonstratedTargets: z.literal(true),
  loops: z.array(
    z.object({
      collectionDescription: z.string(),
      templateActionIds: z.array(z.string()).min(1),
      templateRowFingerprint: z.string(),
      nextItemRelationship: z.enum([
        "next-sibling",
        "next-row",
        "next-matching-container",
      ]),
      eligibilityPredicate: z.string(),
      maximumIterations: z.number().int().min(1).max(1000),
      maximumDurationMs: z.number().int().min(1000).max(3_600_000),
      duplicateItemProtection: z.literal(true),
      errorPolicy: z.enum(["stop-first-required-failure", "continue-optional"]),
    }),
  ),
});

export type AiGeneralizationOutput = z.infer<
  typeof AiGeneralizationOutputSchema
>;

export type AiPayload = {
  promptVersion: string;
  instruction: string;
  demonstration: {
    id: string;
    pages: Array<{
      id: string;
      role: string;
      origin: string;
      pathname: string;
      parentId?: string;
      structuralFingerprint: string;
    }>;
    actions: Array<{
      id: string;
      action: string;
      pageContextId: string;
      target?: {
        tag: string;
        role?: string;
        accessibleName?: string;
        associatedLabel?: string;
        semanticContainer?: string;
        fingerprint: string;
      };
      valueRef?: string;
    }>;
  };
  intentionalValues: Record<string, string>;
  exclusions: {
    queryParameters: true;
    passwords: true;
    cookies: true;
    browserStorage: true;
    authorization: true;
    arbitraryFormValues: true;
  };
};

export interface GeneralizationProvider {
  readonly mode: "mock-ai-generalization";
  generalize(payload: AiPayload): Promise<unknown>;
}

export class MockGeneralizationProvider implements GeneralizationProvider {
  readonly mode = "mock-ai-generalization" as const;

  async generalize(payload: AiPayload): Promise<unknown> {
    const repeat = /\b(repeat|each|following|chaque|suivant|rép[eé]t)/i.test(
      payload.instruction,
    );
    return {
      summary: repeat
        ? "Mocked bounded iteration over the demonstrated repeated structure."
        : "Mocked semantic annotations preserving the literal demonstration.",
      preserveDemonstratedTargets: true,
      loops: repeat
        ? [
            {
              collectionDescription: "Eligible repeated items",
              templateActionIds: payload.demonstration.actions
                .filter((action) =>
                  ["click", "fill", "select", "check", "uncheck"].includes(
                    action.action,
                  ),
                )
                .map((action) => action.id),
              templateRowFingerprint: sha256(
                payload.demonstration.actions
                  .map((action) => action.target?.semanticContainer ?? "")
                  .join("|"),
              ),
              nextItemRelationship: "next-matching-container",
              eligibilityPredicate: "next repeated item is visible and enabled",
              maximumIterations: 100,
              maximumDurationMs: 600_000,
              duplicateItemProtection: true,
              errorPolicy: "stop-first-required-failure",
            },
          ]
        : [],
    };
  }
}

function redactStructuralText(value: string | undefined) {
  if (!value) return undefined;
  return value
    .replaceAll(
      /\b(?:patient|dossier|record)\s*[:#-]?\s*[a-z0-9_-]+/gi,
      "[REDACTED_IDENTIFIER]",
    )
    .slice(0, 160);
}

export function buildAiPayload(
  rawSession: DemonstrationSession,
  instruction: string,
  values: LocalVariableValues,
): AiPayload {
  const session = DemonstrationSessionSchema.parse(rawSession);
  assertNoLocalValuesInSession(session, values);
  return {
    promptVersion: PROMPT_VERSION,
    instruction,
    demonstration: {
      id: session.id,
      pages: session.pages.map((page) => ({
        id: page.id,
        role: page.role,
        origin: page.origin,
        pathname: page.pathname,
        ...(page.parentId ? { parentId: page.parentId } : {}),
        structuralFingerprint: page.structuralFingerprint,
      })),
      actions: session.actions.map((action) => ({
        id: action.id,
        action: action.action,
        pageContextId: action.pageContextId,
        ...(action.target
          ? {
              target: {
                tag: action.target.tag,
                ...(action.target.role ? { role: action.target.role } : {}),
                ...(action.target.accessibleName
                  ? {
                      accessibleName: redactStructuralText(
                        action.target.accessibleName,
                      )!,
                    }
                  : {}),
                ...(action.target.associatedLabel
                  ? {
                      associatedLabel: redactStructuralText(
                        action.target.associatedLabel,
                      )!,
                    }
                  : {}),
                ...(action.target.semanticContainer?.heading
                  ? {
                      semanticContainer: redactStructuralText(
                        action.target.semanticContainer.heading,
                      )!,
                    }
                  : {}),
                fingerprint: action.target.fingerprint,
              },
            }
          : {}),
        ...(action.valueRef ? { valueRef: action.valueRef } : {}),
      })),
    },
    intentionalValues: valuesForAiInstruction(session.variables, values),
    exclusions: {
      queryParameters: true,
      passwords: true,
      cookies: true,
      browserStorage: true,
      authorization: true,
      arbitraryFormValues: true,
    },
  };
}

function compileOutcome(session: DemonstrationSession): ApplicationOutcome {
  const success = session.actions
    .flatMap((action) => action.observedEffects)
    .find((effect) => effect.type === "success-visible");
  if (!success?.pageContextId || !success.description) {
    throw new Error(
      "Compilation requires positive success evidence from the demonstrated after-state.",
    );
  }
  return {
    positiveEvidence: [
      {
        type: "text-visible",
        pageContextId: success.pageContextId,
        target: success.description,
        expected: true,
        required: true,
      },
      ...session.actions
        .filter((action) => action.action === "popup-close")
        .map((action) => ({
          type: "popup-closed" as const,
          pageContextId: action.pageContextId,
          target: action.pageContextId,
          expected: true as const,
          required: true,
        })),
    ],
    negativeEvidence: [
      {
        type: "error-marker",
        target: '[data-vc-outcome="error"]',
        description:
          "Known synthetic application error marker must remain absent.",
      },
      {
        type: "closed-main-page",
        target: "main-application",
        description: "The main page must remain open.",
      },
      {
        type: "unexpected-popup",
        target: "page-context-graph",
        description: "No unmodeled popup may remain open.",
      },
    ],
    requireAllPositive: true,
  };
}

async function compileSteps(
  session: DemonstrationSession,
  graph: PageContextGraph,
  values: LocalVariableValues,
) {
  const steps: CompiledStep[] = [];
  for (const action of session.actions) {
    const hasExecutableTarget = Boolean(action.target);
    let candidates: Awaited<ReturnType<typeof validateLocatorCandidates>> = [];
    let selectedLocatorId: string | undefined;
    if (action.target) {
      const root =
        action.target.frame.role === "main"
          ? graph.page(action.pageContextId)
          : graph.frame(action.pageContextId);
      if (!root)
        throw new Error(
          `Cannot validate demonstrated target in page context ${action.pageContextId}.`,
        );
      candidates =
        "isClosed" in root && root.isClosed()
          ? validateCapturedLocatorCandidates(action.target)
          : await validateLocatorCandidates(root, action.target);
      const selected = selectDemonstratedLocator(candidates, {
        requireEditable: ["fill", "select"].includes(action.action),
      });
      selectedLocatorId = selected.id;
    }
    const variable = action.valueRef
      ? session.variables.find(
          (candidate) => action.valueRef === `{{${candidate.name}}}`,
        )
      : undefined;
    const localLiteral =
      variable?.privacy === "local-literal" && variable.name in values
        ? String(values[variable.name])
        : undefined;
    const preconditions = hasExecutableTarget
      ? [
          {
            type: "visible" as const,
            expected: true,
            description: "Target is visible.",
          },
          {
            type: "enabled" as const,
            expected: true,
            description: "Target is enabled.",
          },
          ...(["fill", "select"].includes(action.action)
            ? [
                {
                  type: "editable" as const,
                  expected: true,
                  description: "Target is compatible with demonstrated input.",
                },
              ]
            : []),
        ]
      : [];
    const postconditions =
      action.action === "fill" && action.target?.backingFieldSelector
        ? [
            {
              type: "backing-field-synchronized" as const,
              expected: true,
              description:
                "Legacy editor facade and backing field are synchronized.",
            },
          ]
        : [];
    steps.push({
      id: createId("step"),
      sourceActionId: action.id,
      pageContextId: action.pageContextId,
      action: action.action,
      name: action.name,
      ...(action.target ? { target: action.target } : {}),
      locatorCandidates: candidates,
      ...(selectedLocatorId ? { selectedLocatorId } : {}),
      ...(action.valueRef && !localLiteral
        ? { valueRef: action.valueRef }
        : {}),
      ...(localLiteral !== undefined ? { localLiteral } : {}),
      ...(action.key ? { key: action.key } : {}),
      optional: action.optional,
      preconditions,
      postconditions,
    });
  }
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step || step.action !== "popup-open") continue;
    const previous = [...steps.slice(0, index)]
      .reverse()
      .find((candidate) => candidate.action === "click");
    if (previous) previous.expectsPopupContextId = step.pageContextId;
    const close = steps
      .slice(index + 1)
      .find(
        (candidate) =>
          candidate.action === "popup-close" &&
          candidate.pageContextId === step.pageContextId,
      );
    const closeIndex = close ? steps.indexOf(close) : -1;
    const hasPopupActionBeforeClose =
      closeIndex > index &&
      steps
        .slice(index + 1, closeIndex)
        .some(
          (candidate) =>
            candidate.pageContextId === step.pageContextId &&
            Boolean(candidate.target),
        );
    if (close && previous && !hasPopupActionBeforeClose)
      previous.expectsPopupClosure = true;
  }
  return steps;
}

function compileLoops(
  output: AiGeneralizationOutput | undefined,
  steps: CompiledStep[],
  session: DemonstrationSession,
): CompiledLoop[] {
  if (!output) return [];
  return output.loops.map((loop) => {
    const templateStepIds = steps
      .filter((step) => loop.templateActionIds.includes(step.sourceActionId))
      .map((step) => step.id);
    if (templateStepIds.length === 0)
      throw new Error(
        "Generalization loop did not reference demonstrated actions.",
      );
    return {
      id: createId("loop"),
      collectionDescription: loop.collectionDescription,
      templatePageContextId:
        steps.find((step) => templateStepIds.includes(step.id))
          ?.pageContextId ?? session.pages[0]!.id,
      templateStepIds,
      templateRowFingerprint: loop.templateRowFingerprint,
      nextItemRelationship: loop.nextItemRelationship,
      eligibilityPredicate: loop.eligibilityPredicate,
      stoppingConditions: [
        { type: "no-next-eligible-item" },
        { type: "maximum-iterations", maximum: loop.maximumIterations },
        { type: "maximum-duration-ms", maximum: loop.maximumDurationMs },
        { type: "duplicate-fingerprint" },
        { type: "user-stop" },
      ],
      maximumIterations: loop.maximumIterations,
      maximumDurationMs: loop.maximumDurationMs,
      duplicateItemProtection: loop.duplicateItemProtection,
      errorPolicy: loop.errorPolicy,
    };
  });
}

function generatePlaywright(workflowId: string, steps: CompiledStep[]) {
  const lines = [
    `// Generated deterministic outline for ${workflowId}.`,
    "// Runtime values are resolved locally; no OpenAI dependency is used.",
    "export async function run(page, variables) {",
  ];
  for (const step of steps) {
    const selected = step.locatorCandidates.find(
      (candidate) => candidate.id === step.selectedLocatorId,
    );
    if (step.action === "fill" && selected) {
      lines.push(
        `  await ${selected.selectorPreview}.fill(variables.${step.valueRef?.slice(2, -2) ?? "value"});`,
      );
    } else if (step.action === "click" && selected) {
      lines.push(`  await ${selected.selectorPreview}.click();`);
    } else {
      lines.push(`  // ${step.action}: ${step.name}`);
    }
  }
  lines.push("}");
  return lines.join("\n");
}

export type CompileOptions = {
  session: DemonstrationSession;
  graph: PageContextGraph;
  localValues: LocalVariableValues;
  generalizationInstruction?: string;
  provider?: GeneralizationProvider;
};

export async function compileDemonstration({
  session: rawSession,
  graph,
  localValues,
  generalizationInstruction = "",
  provider = new MockGeneralizationProvider(),
}: CompileOptions): Promise<{
  workflow: CompiledWorkflow;
  aiPayload?: AiPayload;
}> {
  const session = DemonstrationSessionSchema.parse(rawSession);
  assertNoLocalValuesInSession(session, localValues);
  const instruction = generalizationInstruction.trim();
  let aiPayload: AiPayload | undefined;
  let aiOutput: AiGeneralizationOutput | undefined;
  if (instruction) {
    aiPayload = buildAiPayload(session, instruction, localValues);
    aiOutput = AiGeneralizationOutputSchema.parse(
      await provider.generalize(aiPayload),
    );
  }
  const steps = await compileSteps(session, graph, localValues);
  const workflowId = createId("workflow");
  const compileMode = instruction
    ? "mock-ai-generalization"
    : "direct-demonstration";
  const workflow = CompiledWorkflowSchema.parse({
    schemaVersion: "2.0.0",
    id: workflowId,
    version: "1.0.0",
    sourceDemonstrationId: session.id,
    compileMode,
    pageContexts: session.pages.map((page) => ({
      ...page,
      resolutionOrder: [
        "opener",
        "origin-path",
        "title",
        "structural-fingerprint",
        "landmark",
        "page-role",
      ],
    })),
    steps,
    loops: compileLoops(aiOutput, steps, session),
    variables: session.variables,
    expectedOutcome: compileOutcome(session),
    compilationMetadata: {
      compiledAt: new Date().toISOString(),
      ...(instruction
        ? { promptVersion: PROMPT_VERSION, model: "mock-gpt-5.6" }
        : {}),
      modelCalls: 0,
      ...(aiPayload
        ? { payloadSha256: sha256(JSON.stringify(aiPayload)) }
        : {}),
      diagnostics: [
        {
          level: "info",
          code: instruction ? "MOCK_AI_ONLY" : "DIRECT_COMPILATION",
          message: instruction
            ? "Structured AI generalization was produced by a mock; no live model call occurred."
            : "The literal demonstration compiled locally without GPT.",
        },
      ],
      generatedPlaywright: generatePlaywright(workflowId, steps),
    },
  });
  return { workflow, ...(aiPayload ? { aiPayload } : {}) };
}
