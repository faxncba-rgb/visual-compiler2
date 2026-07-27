import { z } from "zod";
import {
  CompiledWorkflowSchema,
  DemonstrationSessionSchema,
  LocatorStrategySchema,
  type ApplicationOutcome,
  type CompiledLoop,
  type CompiledStep,
  type CompiledWorkflow,
  type DemonstrationSession,
  type LocatorCandidate,
} from "../../demonstration-ir/src";
import type { PageContextGraph } from "../../page-context-graph/src";
import {
  generateLocatorCandidates,
  selectDemonstratedLocator,
  validateCapturedLocatorCandidates,
  validateLocatorCandidates,
} from "../../locator-engine/src";
import {
  assertNoLocalValuesInSession,
  type LocalVariableValues,
} from "../../workflow-variables/src";
import { createId, sha256 } from "../../shared/src";

export const PROMPT_VERSION = "semantic-enrichment-gpt-5.6-v3";
export const COMPILE_MODEL = "gpt-5.6";

export type CompilationStage =
  | "demonstration-validation"
  | "generalization"
  | "locator-validation"
  | "application-outcome-validation"
  | "artifact-validation";

export class CompilationStageError extends Error {
  readonly name = "CompilationStageError";

  constructor(
    readonly stage: CompilationStage,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

export type ApplicationOutcomeValidationEvidence = {
  beforeScopedElementCount?: number;
  afterScopedElementCount?: number;
  candidateOutcomeTypes: string[];
  popupLifecycleObserved: boolean;
  pageContextReturned: boolean;
  editorResetObserved: boolean;
  reconciliationStatus: string;
  selectedPositiveOutcome?: string;
  rejectedCandidates: Array<{
    type: string;
    reasons: string[];
  }>;
};

export class ApplicationOutcomeValidationError extends Error {
  readonly name = "ApplicationOutcomeValidationError";

  constructor(readonly evidence: ApplicationOutcomeValidationEvidence) {
    super(
      "Compilation requires selected positive success evidence from the stable demonstrated after-state.",
    );
  }
}

function compilationStageError(stage: CompilationStage, error: unknown) {
  return error instanceof CompilationStageError
    ? error
    : new CompilationStageError(stage, error);
}

export const SemanticIrSchema = z.object({
  schemaVersion: z.literal("2.0.0"),
  summary: z.string(),
  enrichments: z.array(
    z.object({
      sourceActionId: z.string(),
      intention: z.string(),
      semanticTarget: z.string(),
      recommendedLocator: z
        .object({
          strategy: LocatorStrategySchema,
          selectorPreview: z.string(),
        })
        .nullable(),
      postcondition: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  inferredActions: z.array(
    z.object({
      action: z.enum(["wait", "assert", "navigation", "focus"]),
      name: z.string(),
      position: z.object({
        relativeToSourceActionId: z.string(),
        placement: z.enum(["before", "after"]),
      }),
      pageContextId: z.string().nullable(),
      evidenceRefs: z.array(z.string()).min(1),
      confidence: z.number().min(0).max(1),
      justification: z.string(),
      asPostcondition: z.boolean().default(false),
    }),
  ),
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

export const AiGeneralizationOutputSchema = SemanticIrSchema;
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
      pageId?: string;
      documentOrdinal: number;
      role: string;
      origin: string;
      pathname: string;
      parentId?: string;
      openerActionId?: string;
      structuralFingerprint: string;
      status: string;
      sameOriginInspectable: boolean;
    }>;
    actions: Array<{
      ordinal: number;
      id: string;
      action: string;
      pageContextId: string;
      timestampOffsetMs: number;
      keyboard?: {
        key: string;
        scope: "focused-element" | "page";
      };
      target?: {
        tag: string;
        role?: string;
        accessibleName?: string;
        associatedLabel?: string;
        semanticContainer?: string;
        fingerprint: string;
        controlFamily?: string;
        editable: boolean;
        visibleAtCapture: boolean;
        enabledAtCapture: boolean;
        transientAtCapture: boolean;
        transientAncestorRole?: string;
        frame: {
          role: string;
          origin: string;
          pathname: string;
          name?: string;
          title?: string;
        };
        stableAttributeNames: string[];
        clickEvidence?: {
          rawTag: string;
          normalizedTag: string;
          iconAlt?: string;
          iconTitle?: string;
          iconSrc?: string;
          canonicalHref?: string;
          onclick?: string;
          formName?: string;
          rowIndex?: number;
          columnIndex?: number;
          headers: string[];
          rowText: string[];
          domRelations: string[];
          structuralSnapshot: string[];
        };
        locatorCandidates: Array<{
          strategy: LocatorCandidate["strategy"];
          selectorPreview: string;
        }>;
      };
      valueRef?: string;
      outputVariable?: string;
      reactions: Array<{
        type: string;
        pageContextId?: string;
        fingerprint?: string;
        description: string;
      }>;
      resultingStateFingerprint?: string;
      beforeStateFingerprint?: string;
      forensicSelectionKeys?: string[];
    }>;
  };
  outcome: {
    verification: string;
    candidates: Array<{
      type: string;
      observed: boolean;
      confidence: number;
      target: string;
    }>;
    reconciliation?: {
      status: string;
      popupOpened: boolean;
      popupClosed: boolean;
      frameReplacementObserved: boolean;
      pageContextReturned: boolean;
      editorResetObserved: boolean;
    };
  };
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
  readonly mode: "mock-ai-generalization" | "live-gpt-generalization";
  readonly model: typeof COMPILE_MODEL;
  generalize(payload: AiPayload): Promise<unknown>;
}

export class MockGeneralizationProvider implements GeneralizationProvider {
  readonly mode = "mock-ai-generalization" as const;
  readonly model = COMPILE_MODEL;

  async generalize(payload: AiPayload): Promise<unknown> {
    const repeat = /\b(repeat|each|following|chaque|suivant|rép[eé]t)/i.test(
      payload.instruction,
    );
    return {
      schemaVersion: "2.0.0",
      summary: repeat
        ? "Mocked bounded iteration over the demonstrated repeated structure."
        : "Mocked semantic annotations preserving the literal demonstration.",
      enrichments: payload.demonstration.actions.map((action) => ({
        sourceActionId: action.id,
        intention: `Interpret demonstrated ${action.action} action ${action.ordinal}.`,
        semanticTarget:
          action.target?.accessibleName ??
          action.target?.associatedLabel ??
          action.target?.clickEvidence?.iconAlt ??
          "Demonstrated page state",
        recommendedLocator: action.target?.locatorCandidates[0] ?? null,
        postcondition: action.reactions[0]?.description ?? null,
        confidence: 0.96,
      })),
      inferredActions: [],
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

type FetchImplementation = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const semanticIrJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "summary",
    "enrichments",
    "inferredActions",
    "loops",
  ],
  properties: {
    schemaVersion: { type: "string", const: "2.0.0" },
    summary: { type: "string" },
    enrichments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "sourceActionId",
          "intention",
          "semanticTarget",
          "recommendedLocator",
          "postcondition",
          "confidence",
        ],
        properties: {
          sourceActionId: { type: "string" },
          intention: { type: "string" },
          semanticTarget: { type: "string" },
          recommendedLocator: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["strategy", "selectorPreview"],
                properties: {
                  strategy: {
                    type: "string",
                    enum: LocatorStrategySchema.options,
                  },
                  selectorPreview: { type: "string" },
                },
              },
              { type: "null" },
            ],
          },
          postcondition: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    inferredActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "action",
          "name",
          "position",
          "pageContextId",
          "evidenceRefs",
          "confidence",
          "justification",
          "asPostcondition",
        ],
        properties: {
          action: {
            type: "string",
            enum: ["wait", "assert", "navigation", "focus"],
          },
          name: { type: "string" },
          position: {
            type: "object",
            additionalProperties: false,
            required: ["relativeToSourceActionId", "placement"],
            properties: {
              relativeToSourceActionId: { type: "string" },
              placement: { type: "string", enum: ["before", "after"] },
            },
          },
          pageContextId: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          evidenceRefs: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          justification: { type: "string" },
          asPostcondition: { type: "boolean" },
        },
      },
    },
    loops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "collectionDescription",
          "templateActionIds",
          "templateRowFingerprint",
          "nextItemRelationship",
          "eligibilityPredicate",
          "maximumIterations",
          "maximumDurationMs",
          "duplicateItemProtection",
          "errorPolicy",
        ],
        properties: {
          collectionDescription: { type: "string" },
          templateActionIds: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          templateRowFingerprint: { type: "string" },
          nextItemRelationship: {
            type: "string",
            enum: ["next-sibling", "next-row", "next-matching-container"],
          },
          eligibilityPredicate: { type: "string" },
          maximumIterations: {
            type: "integer",
            minimum: 1,
            maximum: 1000,
          },
          maximumDurationMs: {
            type: "integer",
            minimum: 1000,
            maximum: 3_600_000,
          },
          duplicateItemProtection: { type: "boolean", const: true },
          errorPolicy: {
            type: "string",
            enum: ["stop-first-required-failure", "continue-optional"],
          },
        },
      },
    },
  },
} as const;

function responseOutputText(response: unknown) {
  if (!response || typeof response !== "object") return undefined;
  const direct = (response as { output_text?: unknown }).output_text;
  if (typeof direct === "string") return direct;
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return undefined;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      )
        return (part as { text: string }).text;
    }
  }
  return undefined;
}

export class OpenAiCompileProvider implements GeneralizationProvider {
  readonly mode = "live-gpt-generalization" as const;
  readonly model = COMPILE_MODEL;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {
    if (!apiKey.trim())
      throw new Error("GPT-5.6 compile-time API configuration is empty.");
  }

  async generalize(payload: AiPayload): Promise<unknown> {
    const response = await this.fetchImplementation(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          reasoning: { effort: "medium" },
          input: [
            {
              role: "developer",
              content:
                "Enrich the immutable redacted browser actions by sourceActionId. Do not regenerate action IDs, action types, or ordering. Recommend semantic locators from the supplied capture-time candidates. Put genuinely inferred behavior only in inferredActions with evidence references, insertion position, and confidence. A reactive navigation may be expressed as a postcondition. Return only the requested schema.",
            },
            {
              role: "user",
              content: JSON.stringify(payload),
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "visual_compiler_semantic_ir",
              strict: true,
              schema: semanticIrJsonSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok)
      throw new Error(
        `GPT-5.6 compile-time request failed with HTTP ${response.status}.`,
      );
    const outputText = responseOutputText(await response.json());
    if (!outputText)
      throw new Error(
        "GPT-5.6 compile-time response did not contain structured output.",
      );
    try {
      return JSON.parse(outputText) as unknown;
    } catch {
      throw new Error(
        "GPT-5.6 compile-time response contained invalid structured JSON.",
      );
    }
  }
}

function validateSemanticIr(rawOutput: unknown, session: DemonstrationSession) {
  const output = SemanticIrSchema.parse(rawOutput);
  const actionIds = new Set(session.actions.map((action) => action.id));
  const enrichmentIds = new Set<string>();
  for (const enrichment of output.enrichments) {
    if (!actionIds.has(enrichment.sourceActionId))
      throw new Error(
        "GPT-5.6 enrichment referenced an unknown sourceActionId.",
      );
    if (enrichmentIds.has(enrichment.sourceActionId))
      throw new Error("GPT-5.6 enrichment duplicated a sourceActionId.");
    enrichmentIds.add(enrichment.sourceActionId);
  }
  for (const inferred of output.inferredActions) {
    if (!actionIds.has(inferred.position.relativeToSourceActionId))
      throw new Error(
        "GPT-5.6 inferred action referenced an unknown insertion sourceActionId.",
      );
    if (
      inferred.pageContextId &&
      !session.pages.some((page) => page.id === inferred.pageContextId)
    )
      throw new Error(
        "GPT-5.6 inferred action referenced an unknown document context.",
      );
    if (
      inferred.evidenceRefs.some(
        (reference) =>
          !actionIds.has(reference) &&
          !session.actions.some((action) =>
            action.observedEffects.some(
              (effect) =>
                effect.fingerprint === reference ||
                effect.pageContextId === reference,
            ),
          ),
      )
    )
      throw new Error(
        "GPT-5.6 inferred action lacked demonstrated evidence references.",
      );
  }
  return output;
}

function redactStructuralText(value: string | undefined) {
  if (!value) return undefined;
  return value
    .replaceAll(/https?:\/\/[^\s]+/gi, (match) => {
      try {
        const url = new URL(match);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[REDACTED_URL]";
      }
    })
    .replaceAll(
      /\b(?:password|passcode|token|secret|cookie|authorization|bearer|api[-_ ]?key)\s*[:=]\s*\S+/gi,
      "[REDACTED_SECRET]",
    )
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
    instruction: redactStructuralText(instruction) ?? "",
    demonstration: {
      id: session.id,
      pages: session.pages.map((page) => ({
        id: page.id,
        ...(page.pageId ? { pageId: page.pageId } : {}),
        documentOrdinal: page.documentOrdinal,
        role: page.role,
        origin: page.origin,
        pathname: page.pathname,
        ...(page.parentId ? { parentId: page.parentId } : {}),
        ...(page.openerActionId ? { openerActionId: page.openerActionId } : {}),
        structuralFingerprint: page.structuralFingerprint,
        status: page.status,
        sameOriginInspectable: page.sameOriginInspectable,
      })),
      actions: session.actions.map((action, index) => ({
        ordinal: action.sequence ?? index + 1,
        id: action.id,
        action: action.action,
        pageContextId: action.pageContextId,
        timestampOffsetMs: action.timestampOffsetMs,
        ...(action.action === "keyboard" && action.key
          ? {
              keyboard: {
                key: action.key,
                scope: action.keyboardScope ?? "focused-element",
              },
            }
          : {}),
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
                ...(action.target.descriptor?.controlFamily
                  ? {
                      controlFamily: action.target.descriptor.controlFamily,
                    }
                  : {}),
                editable: action.target.editable,
                visibleAtCapture: action.target.visible,
                enabledAtCapture: action.target.enabled,
                transientAtCapture: action.target.captureContext.transient,
                ...(action.target.captureContext.ancestorRole
                  ? {
                      transientAncestorRole:
                        action.target.captureContext.ancestorRole,
                    }
                  : {}),
                frame: {
                  role: action.target.frame.role,
                  origin: action.target.frame.origin,
                  pathname: action.target.frame.pathname,
                  ...(action.target.frame.name
                    ? { name: action.target.frame.name }
                    : {}),
                  ...(action.target.frame.title
                    ? { title: action.target.frame.title }
                    : {}),
                },
                stableAttributeNames: Object.keys(
                  action.target.stableAttributes,
                ),
                ...(action.target.clickEvidence
                  ? {
                      clickEvidence: {
                        rawTag: action.target.clickEvidence.rawTarget.tag,
                        normalizedTag:
                          action.target.clickEvidence.normalizedClickable.tag,
                        ...(action.target.clickEvidence.icon?.alt
                          ? {
                              iconAlt: redactStructuralText(
                                action.target.clickEvidence.icon.alt,
                              )!,
                            }
                          : {}),
                        ...(action.target.clickEvidence.icon?.title
                          ? {
                              iconTitle: redactStructuralText(
                                action.target.clickEvidence.icon.title,
                              )!,
                            }
                          : {}),
                        ...(action.target.clickEvidence.icon?.src
                          ? {
                              iconSrc: action.target.clickEvidence.icon.src,
                            }
                          : {}),
                        ...(action.target.clickEvidence.canonicalHref
                          ? {
                              canonicalHref:
                                action.target.clickEvidence.canonicalHref,
                            }
                          : {}),
                        ...(action.target.clickEvidence.onclick
                          ? {
                              onclick: redactStructuralText(
                                action.target.clickEvidence.onclick,
                              )!,
                            }
                          : {}),
                        ...(action.target.clickEvidence.form?.name
                          ? {
                              formName: redactStructuralText(
                                action.target.clickEvidence.form.name,
                              )!,
                            }
                          : {}),
                        ...(action.target.clickEvidence.table
                          ? {
                              rowIndex:
                                action.target.clickEvidence.table.rowIndex,
                              columnIndex:
                                action.target.clickEvidence.table.columnIndex,
                              headers: action.target.clickEvidence.table.headers
                                .map(redactStructuralText)
                                .filter((entry): entry is string =>
                                  Boolean(entry),
                                ),
                              rowText: action.target.clickEvidence.table.rowText
                                .map(redactStructuralText)
                                .filter((entry): entry is string =>
                                  Boolean(entry),
                                ),
                            }
                          : { headers: [], rowText: [] }),
                        domRelations: action.target.clickEvidence.domRelations,
                        structuralSnapshot:
                          action.target.clickEvidence.structuralSnapshot,
                      },
                    }
                  : {}),
                locatorCandidates: generateLocatorCandidates(
                  action.target,
                  action.sequenceContext,
                ).map((candidate) => ({
                  strategy: candidate.strategy,
                  selectorPreview: candidate.selectorPreview,
                })),
              },
            }
          : {}),
        ...(action.valueRef ? { valueRef: action.valueRef } : {}),
        ...(action.outputVariable
          ? { outputVariable: action.outputVariable }
          : {}),
        reactions: action.observedEffects.map((effect) => ({
          type: effect.type,
          ...(effect.pageContextId
            ? { pageContextId: effect.pageContextId }
            : {}),
          ...(effect.fingerprint ? { fingerprint: effect.fingerprint } : {}),
          description:
            redactStructuralText(effect.description) ??
            "Redacted demonstrated reaction.",
        })),
        ...(action.resultingState?.fingerprint
          ? {
              resultingStateFingerprint: action.resultingState.fingerprint,
            }
          : {}),
        ...(action.beforeState?.fingerprint
          ? {
              beforeStateFingerprint: action.beforeState.fingerprint,
            }
          : {}),
        ...(action.selectionGesture
          ? {
              forensicSelectionKeys: action.selectionGesture.keys,
            }
          : {}),
      })),
    },
    outcome: {
      verification: session.outcomeVerification,
      candidates: session.outcomeCandidates.map((candidate) => ({
        type: candidate.type,
        observed: candidate.observed,
        confidence: candidate.confidence,
        target: redactStructuralText(candidate.target) ?? "[REDACTED_TARGET]",
      })),
      ...(session.effectReconciliation
        ? {
            reconciliation: {
              status: session.effectReconciliation.status,
              popupOpened: session.effectReconciliation.popupOpened,
              popupClosed: session.effectReconciliation.popupClosed,
              frameReplacementObserved:
                session.effectReconciliation.frameReplacementObserved,
              pageContextReturned:
                session.effectReconciliation.pageContextReturned,
              editorResetObserved:
                session.effectReconciliation.editorResetObserved,
            },
          }
        : {}),
    },
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

function compileOutcome(
  session: DemonstrationSession,
  steps: CompiledStep[],
): ApplicationOutcome {
  const candidates = session.outcomeCandidates;
  const observed = candidates
    .filter((candidate) => candidate.observed)
    .sort((left, right) => right.confidence - left.confidence);
  const selected = observed.slice(0, 1);
  const outcomeVerification =
    session.outcomeVerification !== "UNVERIFIED"
      ? session.outcomeVerification
      : observed.length === 0
        ? "UNVERIFIED"
        : observed[0]!.confidence >= 0.85 &&
            session.effectReconciliation?.status === "stable"
          ? "VERIFIED"
          : "PARTIALLY_VERIFIED";
  const evidence: ApplicationOutcomeValidationEvidence = {
    ...(session.applicationStateBefore?.historyCount !== undefined
      ? {
          beforeScopedElementCount: session.applicationStateBefore.historyCount,
        }
      : {}),
    ...(session.applicationStateAfter?.historyCount !== undefined
      ? { afterScopedElementCount: session.applicationStateAfter.historyCount }
      : {}),
    candidateOutcomeTypes: candidates.map((candidate) => candidate.type),
    popupLifecycleObserved: Boolean(
      session.effectReconciliation?.popupOpened &&
        session.effectReconciliation.popupClosed,
    ),
    pageContextReturned:
      session.effectReconciliation?.pageContextReturned ?? false,
    editorResetObserved:
      session.effectReconciliation?.editorResetObserved ?? false,
    reconciliationStatus:
      session.effectReconciliation?.status ?? "legacy-insufficient",
    ...(selected[0] ? { selectedPositiveOutcome: selected[0].type } : {}),
    rejectedCandidates: candidates
      .filter((candidate) => !candidate.observed)
      .map((candidate) => ({
        type: candidate.type,
        reasons: candidate.rejectionReasons,
      })),
  };
  const positiveEvidence: ApplicationOutcome["positiveEvidence"] = [];
  for (const candidate of selected) {
    const required = outcomeVerification === "VERIFIED";
    if (
      candidate.type === "relative-count-increase" ||
      candidate.type === "new-scoped-item"
    ) {
      positiveEvidence.push({
        type: "relative-count-increase",
        pageContextId: candidate.pageContextId,
        target: candidate.target,
        expected: candidate.minimumIncrease ?? 1,
        required,
      });
      continue;
    }
    if (candidate.type === "new-item-contains-variable") {
      positiveEvidence.push({
        type: "new-item-contains-variable",
        pageContextId: candidate.pageContextId,
        target: candidate.target,
        expected: true,
        ...(candidate.variableRef
          ? { variableRef: candidate.variableRef }
          : {}),
        required,
      });
      continue;
    }
    if (candidate.type === "editor-reset") {
      const saveAction = candidate.sourceActionId
        ? session.actions.find(
            (action) => action.id === candidate.sourceActionId,
          )
        : undefined;
      const fillStep = saveAction?.sequenceContext
        ? steps.find(
            (step) =>
              step.sourceActionId ===
              saveAction.sequenceContext?.previousActionId,
          )
        : undefined;
      positiveEvidence.push({
        type: "editor-reset",
        pageContextId: candidate.pageContextId,
        target: candidate.target,
        expected: true,
        ...(fillStep ? { sourceStepId: fillStep.id } : {}),
        required,
      });
      continue;
    }
    if (candidate.type === "popup-lifecycle") {
      const popupClose = [...session.actions]
        .reverse()
        .find((action) => action.action === "popup-close");
      if (popupClose) {
        positiveEvidence.push({
          type: "popup-closed",
          pageContextId: popupClose.pageContextId,
          target: popupClose.pageContextId,
          expected: true,
          required,
        });
      }
      continue;
    }
    if (candidate.type === "returned-to-page") {
      positiveEvidence.push({
        type: "navigation",
        pageContextId: candidate.pageContextId,
        target: candidate.target,
        expected: true,
        required,
      });
      continue;
    }
    if (candidate.type === "field-unchanged") {
      positiveEvidence.push({
        type: "field-unchanged",
        pageContextId: candidate.pageContextId,
        target: candidate.target,
        expected: true,
        required,
      });
      continue;
    }
    positiveEvidence.push({
      type: "element-visible",
      pageContextId: candidate.pageContextId,
      target: candidate.target,
      expected: true,
      required,
    });
  }
  return {
    positiveEvidence,
    negativeEvidence: [
      {
        type: "error-marker",
        target: '[data-vc-outcome="error"]',
        description: "Known application error marker must remain absent.",
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
    requireAllPositive: outcomeVerification === "VERIFIED",
    verification:
      positiveEvidence.length === 0 ? "UNVERIFIED" : outcomeVerification,
  };
}

function inputStrategiesFor(action: DemonstrationSession["actions"][number]) {
  if (!["fill", "select"].includes(action.action)) return undefined;
  if (action.action === "select") return ["playwright-fill"] as const;
  switch (action.target?.editorAdapter) {
    case "keyboard":
      return ["sequential-keys", "native-value-setter"] as const;
    case "legacy-facade":
      return [
        "contenteditable-fill",
        "legacy-backing-sync",
        "sequential-keys",
        "native-value-setter",
      ] as const;
    case "contenteditable":
      return [
        "contenteditable-fill",
        "sequential-keys",
        "native-value-setter",
      ] as const;
    default:
      return [
        "playwright-fill",
        "sequential-keys",
        "native-value-setter",
      ] as const;
  }
}

async function compileSteps(
  session: DemonstrationSession,
  graph: PageContextGraph,
  values: LocalVariableValues,
  aiOutput: AiGeneralizationOutput,
) {
  const steps: CompiledStep[] = [];
  for (
    let actionIndex = 0;
    actionIndex < session.actions.length;
    actionIndex += 1
  ) {
    const action = session.actions[actionIndex]!;
    const stepId = createId("step");
    const hasExecutableTarget = Boolean(action.target);
    let candidates: Awaited<ReturnType<typeof validateLocatorCandidates>> = [];
    let selectedLocatorId: string | undefined;
    const enrichment = aiOutput.enrichments.find(
      (candidate) => candidate.sourceActionId === action.id,
    );
    if (action.target) {
      const generatedCandidates = generateLocatorCandidates(
        action.target,
        action.sequenceContext,
      );
      const liveResolution = await graph.resolveLiveTargetRoot(
        action.pageContextId,
        action.target.descriptor?.frame ?? {
          role: action.target.frame.role,
          name: action.target.frame.name,
          title: action.target.frame.title,
          origin: action.target.frame.origin,
          pathname: action.target.frame.pathname,
        },
      );
      candidates = validateCapturedLocatorCandidates(
        action.target,
        generatedCandidates,
      );
      const recommended = enrichment?.recommendedLocator
        ? candidates.find(
            (candidate) =>
              candidate.strategy === enrichment.recommendedLocator?.strategy &&
              candidate.selectorPreview ===
                enrichment.recommendedLocator.selectorPreview,
          )
        : undefined;
      const selectionPool = recommended ? [recommended] : candidates;
      const selected = selectDemonstratedLocator(selectionPool, {
        requireEditable: ["fill", "select"].includes(action.action),
        target: action.target,
        action: action.action,
        originalDomNodeReplaced: liveResolution.originalDomNodeReplaced,
        semanticEquivalentFound: liveResolution.semanticEquivalentFound,
        stepId,
        actionIndex,
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
    const postconditions: CompiledStep["postconditions"] =
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
    for (const effect of action.observedEffects) {
      if (effect.type !== "navigation" || !effect.pageContextId) continue;
      const navigatedDocument = session.pages.find(
        (page) => page.id === effect.pageContextId,
      );
      if (!navigatedDocument) continue;
      if (
        action.beforeState?.origin === navigatedDocument.origin &&
        action.beforeState?.pathname === navigatedDocument.pathname
      )
        continue;
      postconditions.push({
        type: "url-path",
        expected: navigatedDocument.pathname,
        description: `The demonstrated action navigates to ${navigatedDocument.pathname}.`,
      });
    }
    steps.push({
      id: stepId,
      sourceActionId: action.id,
      pageContextId: action.pageContextId,
      action: action.action,
      name: action.name,
      ...(action.target ? { target: action.target } : {}),
      ...(action.sequenceContext
        ? { sequenceContext: action.sequenceContext }
        : {}),
      locatorCandidates: candidates,
      ...(selectedLocatorId ? { selectedLocatorId } : {}),
      ...(action.value ? { value: action.value } : {}),
      ...(action.outputVariable
        ? { outputVariable: action.outputVariable }
        : {}),
      ...(action.valueRef && !localLiteral
        ? { valueRef: action.valueRef }
        : {}),
      ...(localLiteral !== undefined ? { localLiteral } : {}),
      ...(inputStrategiesFor(action)
        ? { inputStrategies: [...inputStrategiesFor(action)!] }
        : {}),
      ...(action.key ? { key: action.key } : {}),
      ...(action.keyboardScope ? { keyboardScope: action.keyboardScope } : {}),
      optional: action.optional,
      preconditions,
      postconditions,
      ...(enrichment
        ? {
            semanticEnrichment: {
              intention: enrichment.intention,
              semanticTarget: enrichment.semanticTarget,
              ...(enrichment.recommendedLocator
                ? {
                    recommendedLocator: enrichment.recommendedLocator,
                  }
                : {}),
              ...(enrichment.postcondition
                ? { postcondition: enrichment.postcondition }
                : {}),
              confidence: enrichment.confidence,
            },
          }
        : {}),
      inferred: false,
      evidenceRefs: [],
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

function mergeInferredActions(
  output: AiGeneralizationOutput,
  steps: CompiledStep[],
  session: DemonstrationSession,
) {
  const merged = [...steps];
  for (const [inferredIndex, inferred] of output.inferredActions.entries()) {
    const anchorIndex = merged.findIndex(
      (step) =>
        !step.inferred &&
        step.sourceActionId === inferred.position.relativeToSourceActionId,
    );
    if (anchorIndex < 0)
      throw new Error(
        "Inferred action insertion point does not exist in the immutable local actions.",
      );
    const anchor = merged[anchorIndex]!;
    const pageContextId = inferred.pageContextId ?? anchor.pageContextId;
    const pageContext = session.pages.find(
      (candidate) => candidate.id === pageContextId,
    );
    if (!pageContext)
      throw new Error(
        "Inferred action document context is not part of the demonstration.",
      );
    if (inferred.asPostcondition) {
      anchor.postconditions.push({
        type: inferred.action === "navigation" ? "url-path" : "text-visible",
        ...(inferred.action === "navigation"
          ? { expected: pageContext.pathname }
          : {}),
        description: inferred.justification,
      });
      continue;
    }
    const step: CompiledStep = {
      id: createId("step"),
      sourceActionId: `inferred:${inferred.position.relativeToSourceActionId}:${inferredIndex + 1}`,
      pageContextId,
      action: inferred.action,
      name: inferred.name,
      locatorCandidates: [],
      optional: inferred.confidence < 0.85,
      preconditions: [],
      postconditions: [],
      semanticEnrichment: {
        intention: inferred.justification,
        semanticTarget: `${pageContext.origin}${pageContext.pathname}`,
        confidence: inferred.confidence,
      },
      inferred: true,
      evidenceRefs: inferred.evidenceRefs,
    };
    merged.splice(
      inferred.position.placement === "before" ? anchorIndex : anchorIndex + 1,
      0,
      step,
    );
  }
  return merged;
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

function generatedLocator(
  candidate: CompiledStep["locatorCandidates"][number],
) {
  const rule = candidate.rule;
  const root = rule.frameTitle
    ? `page.frameLocator('iframe[title=${JSON.stringify(rule.frameTitle)}]')`
    : "page";
  if (rule.strategy === "role-name")
    return `${root}.getByRole(${JSON.stringify(rule.role)}, { name: ${JSON.stringify(rule.name)}, exact: true })`;
  if (rule.strategy === "label-association")
    return `${root}.getByLabel(${JSON.stringify(rule.label)}, { exact: true })`;
  if (rule.strategy === "text-dom-relation")
    return `${root}.locator(${JSON.stringify(rule.tagName)}).filter({ hasText: ${generatedExactTextPattern(rule.staticText ?? "")} })`;
  if (rule.strategy === "form-control-name")
    return `${root}.locator(${JSON.stringify(`[name="${rule.formControlName}"]`)})`;
  if (rule.strategy === "stable-attribute")
    return `${root}.locator(${JSON.stringify(`[${rule.attribute}="${rule.attributeValue}"]`)})`;
  if (rule.strategy === "container-role-name") {
    const container = `${root}.locator('section,form,article,[role=dialog],[role=region]').filter({ has: ${root}.getByRole('heading', { name: ${JSON.stringify(rule.containerHeading)}, exact: true }) })`;
    return `${container}.getByRole(${JSON.stringify(rule.role)}, { name: ${JSON.stringify(rule.name)}, exact: true })`;
  }
  if (rule.strategy === "form-ownership") {
    const selectors = {
      "multiline-text":
        'textarea,[contenteditable="true"][role="textbox"],[contenteditable="true"]',
      "single-line-text":
        'input:not([type="hidden"]):not([type="password"]),[role="textbox"]:not(textarea)',
      selection: "select,[role=combobox],[role=listbox]",
      toggle:
        'input[type="checkbox"],input[type="radio"],[role=checkbox],[role=radio],[role=switch]',
      button: "button,[role=button],input[type=submit],input[type=button]",
      link: "a,[role=link]",
      other: "*",
    };
    const family =
      rule.controlFamily &&
      selectors[rule.controlFamily as keyof typeof selectors];
    const locator = `${root}.locator(${JSON.stringify(`form[name="${rule.formName}"]`)}).locator(${JSON.stringify(family ?? "*")})`;
    return rule.staticText
      ? `${locator}.filter({ hasText: ${generatedExactTextPattern(rule.staticText)} })`
      : locator;
  }
  if (
    rule.strategy === "canonical-href" ||
    rule.strategy === "icon-evidence" ||
    rule.strategy === "row-icon-context"
  ) {
    const href = rule.canonicalHref ? new URL(rule.canonicalHref) : undefined;
    const hrefSelector = href
      ? `a[href^=${JSON.stringify(href.pathname)}],a[href^=${JSON.stringify(`${href.origin}${href.pathname}`)}]`
      : "a[href],a[onclick],[role=link]";
    const iconSelector = rule.iconAlt
      ? `img[alt=${JSON.stringify(rule.iconAlt)}],[role=img][aria-label=${JSON.stringify(rule.iconAlt)}]`
      : rule.iconTitle
        ? `img[title=${JSON.stringify(rule.iconTitle)}],[role=img][title=${JSON.stringify(rule.iconTitle)}]`
        : rule.iconSrc
          ? (() => {
              const icon = new URL(rule.iconSrc);
              return `img[src^=${JSON.stringify(icon.pathname)}],img[src^=${JSON.stringify(`${icon.origin}${icon.pathname}`)}]`;
            })()
          : undefined;
    const scope =
      rule.strategy === "row-icon-context"
        ? `${root}.locator('tr').filter({ hasText: ${JSON.stringify(rule.rowText)} }).locator(${JSON.stringify(hrefSelector)})`
        : `${root}.locator(${JSON.stringify(hrefSelector)})`;
    return iconSelector
      ? `${scope}.filter({ has: ${root}.locator(${JSON.stringify(iconSelector)}) })`
      : scope;
  }
  return `${root}.locator(${JSON.stringify(rule.structuralPath ?? candidate.selectorPreview)})`;
}

function generatedExactTextPattern(value: string) {
  const pattern = `^\\s*${value
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+")}\\s*$`;
  return `new RegExp(${JSON.stringify(pattern)})`;
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
      const generatedValue =
        step.value?.kind === "literal"
          ? JSON.stringify(step.value.value)
          : `variables.${step.value?.kind === "runtime-variable" ? step.value.name : (step.valueRef?.slice(2, -2) ?? "value")}`;
      lines.push(
        `  await ${generatedLocator(selected)}.fill(${generatedValue});`,
      );
    } else if (step.action === "click" && selected) {
      lines.push(`  await ${generatedLocator(selected)}.click();`);
    } else if (step.action === "extract" && selected) {
      lines.push(
        `  variables.${step.outputVariable ?? "copied_text"} = await ${generatedLocator(selected)}.evaluate(element => 'value' in element ? element.value : element.textContent ?? '');`,
      );
    } else if (step.action === "select" && selected) {
      const generatedValue =
        step.value?.kind === "literal"
          ? JSON.stringify(step.value.value)
          : `variables.${step.value?.kind === "runtime-variable" ? step.value.name : (step.valueRef?.slice(2, -2) ?? "value")}`;
      lines.push(
        `  await ${generatedLocator(selected)}.selectOption(${generatedValue});`,
      );
    } else if (step.action === "check" && selected) {
      lines.push(`  await ${generatedLocator(selected)}.check();`);
    } else if (step.action === "uncheck" && selected) {
      lines.push(`  await ${generatedLocator(selected)}.uncheck();`);
    } else if (step.action === "keyboard" && selected) {
      lines.push(
        `  await ${generatedLocator(selected)}.press(${JSON.stringify(step.key ?? "Enter")});`,
      );
    } else if (step.action === "keyboard" && step.keyboardScope === "page") {
      lines.push(
        `  await page.keyboard.press(${JSON.stringify(step.key ?? "Enter")});`,
      );
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
  provider,
}: CompileOptions): Promise<{
  workflow: CompiledWorkflow;
  aiPayload: AiPayload;
}> {
  let session: DemonstrationSession;
  try {
    session = DemonstrationSessionSchema.parse(rawSession);
    assertNoLocalValuesInSession(session, localValues);
    const hasExecutableAction = session.actions.some(
      (action) =>
        (Boolean(action.target) ||
          (action.action === "keyboard" && action.keyboardScope === "page")) &&
        [
          "click",
          "double-click",
          "fill",
          "select",
          "check",
          "uncheck",
          "keyboard",
          "submit",
          "extract",
        ].includes(action.action),
    );
    if (!hasExecutableAction)
      throw new Error(
        "Compilation requires at least one executable demonstrated action.",
      );
  } catch (error) {
    throw compilationStageError("demonstration-validation", error);
  }
  const instruction = generalizationInstruction.trim();
  let aiPayload: AiPayload;
  let aiOutput: AiGeneralizationOutput;
  try {
    if (!provider)
      throw new Error(
        "GPT-5.6 compilation is unavailable. Configure OPENAI_API_KEY in the local ignored environment file.",
      );
    aiPayload = buildAiPayload(session, instruction, localValues);
    aiOutput = validateSemanticIr(
      await provider.generalize(aiPayload),
      session,
    );
  } catch (error) {
    throw compilationStageError("generalization", error);
  }
  let steps: CompiledStep[];
  try {
    steps = mergeInferredActions(
      aiOutput,
      await compileSteps(session, graph, localValues, aiOutput),
      session,
    );
  } catch (error) {
    throw compilationStageError("locator-validation", error);
  }
  let expectedOutcome: ApplicationOutcome;
  try {
    expectedOutcome = compileOutcome(session, steps);
  } catch (error) {
    throw compilationStageError("application-outcome-validation", error);
  }
  const workflowId = createId("workflow");
  const compileMode = provider.mode;
  let workflow: CompiledWorkflow;
  try {
    workflow = CompiledWorkflowSchema.parse({
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
      expectedOutcome,
      compilationMetadata: {
        compiledAt: new Date().toISOString(),
        promptVersion: PROMPT_VERSION,
        model: provider.model,
        modelCalls: 1,
        payloadSha256: sha256(JSON.stringify(aiPayload)),
        diagnostics: [
          {
            level: "info",
            code:
              provider.mode === "live-gpt-generalization"
                ? "GPT_COMPILE_TIME"
                : "MOCK_GPT_COMPILE_TIME",
            message:
              provider.mode === "live-gpt-generalization"
                ? "Validated Semantic IR was produced once by GPT-5.6 at compile time."
                : "Validated Semantic IR was produced once by the automated GPT-5.6 test mock.",
          },
        ],
        generatedPlaywright: generatePlaywright(workflowId, steps),
      },
    });
  } catch (error) {
    throw compilationStageError("artifact-validation", error);
  }
  return { workflow, aiPayload };
}
