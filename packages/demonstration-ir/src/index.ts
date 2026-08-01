import { z } from "zod";

export const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const FrameIdentitySchema = z.object({
  role: z.enum(["main", "same-origin", "cross-origin-opaque"]),
  name: z.string().optional(),
  title: z.string().optional(),
  origin: z.string(),
  pathname: z.string(),
  structuralFingerprint: z.string(),
});

export const DemonstratedTargetDescriptorSchema = z.object({
  controlFamily: z.enum([
    "multiline-text",
    "single-line-text",
    "selection",
    "toggle",
    "button",
    "link",
    "other",
  ]),
  multiline: z.boolean(),
  editable: z.boolean(),
  actionCompatibility: z
    .array(
      z.enum([
        "click",
        "double-click",
        "fill",
        "select",
        "check",
        "uncheck",
        "keyboard",
        "submit",
        "focus",
        "extract",
      ]),
    )
    .min(1),
  tag: z.string().min(1),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  associatedLabel: z.string().optional(),
  normalizedStaticText: z.string().optional(),
  title: z.string().optional(),
  ariaLabel: z.string().optional(),
  hasOnclick: z.boolean().default(false),
  rawTargetPromoted: z.boolean().default(false),
  formName: z.string().optional(),
  hostFormName: z.string().optional(),
  semanticContainer: z
    .object({
      tag: z.string(),
      heading: z.string().optional(),
      landmark: z.string().optional(),
    })
    .optional(),
  neighboringLabels: z.array(z.string()).max(8).default([]),
  precedingLabels: z.array(z.string()).max(8).default([]),
  relatedActionName: z.string().optional(),
  frame: z.object({
    role: z.enum(["main", "same-origin", "cross-origin-opaque"]),
    name: z.string().optional(),
    title: z.string().optional(),
    origin: z.string(),
    pathname: z.string(),
  }),
});

export const DemonstratedTargetSchema = z.object({
  fingerprint: z.string().min(8),
  tag: z.string().min(1),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  associatedLabel: z.string().optional(),
  inputType: z.string().optional(),
  editable: z.boolean(),
  readonly: z.boolean(),
  visible: z.boolean(),
  enabled: z.boolean(),
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  formName: z.string().optional(),
  semanticContainer: z
    .object({
      tag: z.string(),
      heading: z.string().optional(),
      landmark: z.string().optional(),
      fingerprint: z.string(),
    })
    .optional(),
  parent: z
    .object({
      tag: z.string(),
      role: z.string().optional(),
      accessibleName: z.string().optional(),
    })
    .optional(),
  previousSibling: z.string().optional(),
  nextSibling: z.string().optional(),
  nearbyVisibleLabels: z.array(z.string()).max(8).default([]),
  boundingBox: BoundingBoxSchema.optional(),
  rowColumnEvidence: z
    .array(
      z.object({
        relation: z.enum(["same-row", "same-column"]),
        text: z.string(),
      }),
    )
    .default([]),
  frame: FrameIdentitySchema,
  descriptor: DemonstratedTargetDescriptorSchema.optional(),
  stableAttributes: z.record(z.string()).default({}),
  dynamicFormControlIdentity: z
    .object({
      namePrefix: z.string().min(1).max(120),
      ordinal: z.number().int().nonnegative(),
    })
    .optional(),
  unstableAttributes: z.array(z.string()).default([]),
  structuralPath: z.string(),
  beforeFingerprint: z.string().optional(),
  afterFingerprint: z.string().optional(),
  editorAdapter: z
    .enum([
      "playwright-fill",
      "contenteditable",
      "keyboard",
      "same-origin-iframe",
      "legacy-facade",
      "native-value-setter",
    ])
    .optional(),
  backingFieldSelector: z.string().optional(),
  captureValidation: z.object({
    exactTargetConnected: z.literal(true),
    roleNameMatchCount: z.number().int().nonnegative(),
    labelMatchCount: z.number().int().nonnegative(),
    stableAttributeMatchCount: z.number().int().nonnegative(),
  }),
  captureContext: z
    .object({
      transient: z.boolean(),
      ancestorRole: z.string().optional(),
    })
    .default({ transient: false }),
  clickEvidence: z
    .object({
      rawTarget: z.object({
        tag: z.string(),
        role: z.string().optional(),
        alt: z.string().optional(),
        title: z.string().optional(),
        src: z.string().optional(),
        structuralPath: z.string(),
      }),
      normalizedClickable: z.object({
        tag: z.string(),
        role: z.string().optional(),
        accessibleName: z.string().optional(),
        structuralPath: z.string(),
      }),
      icon: z
        .object({
          tag: z.string(),
          alt: z.string().optional(),
          title: z.string().optional(),
          src: z.string().optional(),
        })
        .optional(),
      canonicalHref: z.string().optional(),
      onclick: z.string().optional(),
      form: z
        .object({
          name: z.string().optional(),
          id: z.string().optional(),
          action: z.string().optional(),
        })
        .optional(),
      table: z
        .object({
          rowIndex: z.number().int().nonnegative(),
          columnIndex: z.number().int().nonnegative(),
          headers: z.array(z.string()).max(12),
          rowText: z.array(z.string()).max(12),
        })
        .optional(),
      domRelations: z.array(z.string()).max(12),
      structuralSnapshot: z.array(z.string()).max(32),
      captureValidation: z.object({
        canonicalHrefMatchCount: z.number().int().nonnegative(),
        iconMatchCount: z.number().int().nonnegative(),
        rowIconMatchCount: z.number().int().nonnegative(),
        rowClickableMatchCount: z.number().int().nonnegative().optional(),
      }),
    })
    .optional(),
});

export const RecordedPageContextSchema = z.object({
  id: z.string(),
  pageId: z.string().optional(),
  documentOrdinal: z.number().int().positive().default(1),
  role: z.enum(["main", "popup", "tab", "frame"]),
  parentId: z.string().optional(),
  openerActionId: z.string().optional(),
  origin: z.string(),
  pathname: z.string(),
  titlePattern: z.string().optional(),
  structuralFingerprint: z.string(),
  expectedLandmark: z.string().optional(),
  pageRole: z.string(),
  sameOriginInspectable: z.boolean().default(true),
  status: z.enum(["active", "replaced", "closed", "open"]).default("active"),
});

export const PageContextGraphSchema = z.object({
  rootId: z.string().optional(),
  nodes: z.array(RecordedPageContextSchema),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      relation: z.enum([
        "opened",
        "contains-frame",
        "focus-return",
        "navigated",
      ]),
      actionId: z.string().optional(),
    }),
  ),
});

export const ObservedEffectSchema = z.object({
  type: z.enum([
    "dom-change",
    "navigation",
    "frame-replaced",
    "popup-opened",
    "popup-closed",
    "dialog-opened",
    "focus-moved",
    "value-synchronized",
    "history-increased",
    "editor-reset",
    "returned-to-page",
    "stability-reconciled",
    "success-visible",
    "error-visible",
  ]),
  pageContextId: z.string().optional(),
  fingerprint: z.string().optional(),
  description: z.string(),
});

export const RecordedActionTypeSchema = z.enum([
  "click",
  "double-click",
  "fill",
  "select",
  "check",
  "uncheck",
  "keyboard",
  "submit",
  "wait",
  "dialog",
  "navigation",
  "popup-open",
  "popup-close",
  "focus",
  "extract",
  "assert",
]);

export const DemonstratedSequenceContextSchema = z.object({
  previousActionId: z.string(),
  previousAction: z.enum(["fill", "select"]),
  demonstratedAfterPrevious: z.literal(true),
  sameForm: z.boolean(),
  sameSemanticContainer: z.boolean(),
  savesPreviousEditor: z.boolean(),
});

export const WorkflowActionValueSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("literal"),
    value: z.string(),
    persistence: z.literal("workflow"),
  }),
  z.object({
    kind: z.literal("runtime-variable"),
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    persistence: z.literal("memory-only"),
  }),
]);

export const ExtractionSelectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("element"),
  }),
  z.object({
    mode: z.literal("text-range"),
    startPath: z.array(z.number().int().nonnegative()).max(24),
    startOffset: z.number().int().nonnegative(),
    endPath: z.array(z.number().int().nonnegative()).max(24),
    endOffset: z.number().int().nonnegative(),
  }),
]);

export const RuntimeValueTransformSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("number-in-range"),
    minimum: z.number().finite(),
    maximum: z.number().finite(),
    excludedNumbers: z.array(z.number().finite()).max(32).default([]),
    occurrence: z.literal("first").default("first"),
  }),
]);

export const StepExecutionGuardSchema = z.object({
  type: z.literal("runtime-variable-contains"),
  variableName: z.string().regex(/^[a-z][a-z0-9_]*$/),
  keyword: z.string().min(1).max(80),
  caseSensitive: z.boolean().default(false),
  wholeWord: z.boolean().default(true),
});

export const RecordedActionSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive().optional(),
  captureSequence: z.number().int().positive().optional(),
  pageContextId: z.string(),
  action: RecordedActionTypeSchema,
  name: z.string(),
  target: DemonstratedTargetSchema.optional(),
  sequenceContext: DemonstratedSequenceContextSchema.optional(),
  value: WorkflowActionValueSchema.optional(),
  outputVariable: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
  extractionSelection: ExtractionSelectionSchema.optional(),
  valueRef: z.string().optional(),
  editingTransaction: z
    .object({
      id: z.string(),
      committed: z.boolean(),
      inputEvents: z.number().int().nonnegative(),
      compositionObserved: z.boolean(),
      pasteObserved: z.boolean(),
      selectionObserved: z.boolean(),
    })
    .optional(),
  key: z.string().optional(),
  keyboardScope: z.enum(["focused-element", "page"]).optional(),
  selectionGesture: z
    .object({
      keys: z.array(z.string()).min(1),
      nativeChangeObserved: z.boolean(),
      replayKeyboardEvents: z.boolean(),
    })
    .optional(),
  dialog: z
    .object({
      type: z.enum(["alert", "confirm", "prompt", "beforeunload"]),
      response: z.enum(["accepted", "dismissed"]),
      promptValueRef: z.string().optional(),
    })
    .optional(),
  observedEffects: z.array(ObservedEffectSchema),
  causedByActionId: z.string().optional(),
  beforeState: z.lazy(() => StructuralSnapshotSchema).optional(),
  resultingState: z.lazy(() => StructuralSnapshotSchema).optional(),
  timestampOffsetMs: z.number().nonnegative(),
  optional: z.boolean().default(false),
});

export const WorkflowVariableSchema = z.object({
  id: z.string(),
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  valueType: z.enum(["string", "number", "boolean", "option"]),
  sourceActionId: z.string().optional(),
  privacy: z.enum([
    "local-variable",
    "local-literal",
    "runtime-derived",
    "ai-instruction",
  ]),
  required: z.boolean().default(true),
  description: z.string().optional(),
});

export const StructuralSnapshotSchema = z.object({
  pageContextId: z.string(),
  fingerprint: z.string(),
  visibleLandmarks: z.array(z.string()),
  origin: z.string().optional(),
  pathname: z.string().optional(),
  structuralOutline: z.array(z.string()).default([]),
  capturedAt: z.string().datetime(),
});

export const ApplicationStateSchema = z.object({
  pageContextId: z.string(),
  origin: z.string(),
  pathname: z.string(),
  capturedAt: z.string().datetime(),
  historySelector: z.string().optional(),
  historyCount: z.number().int().nonnegative().optional(),
  editorPresent: z.boolean(),
  editorEmpty: z.boolean().optional(),
  successMarkerVisible: z.boolean(),
  errorMarkerVisible: z.boolean(),
});

export const OutcomeCandidateTypeSchema = z.enum([
  "relative-count-increase",
  "new-scoped-item",
  "new-item-contains-variable",
  "editor-reset",
  "popup-lifecycle",
  "returned-to-page",
  "field-unchanged",
  "success-marker",
]);

export const ApplicationOutcomeCandidateSchema = z.object({
  id: z.string(),
  type: OutcomeCandidateTypeSchema,
  label: z.string(),
  pageContextId: z.string(),
  target: z.string(),
  sourceActionId: z.string().optional(),
  variableRef: z.string().optional(),
  fieldLabel: z.string().optional(),
  beforeCount: z.number().int().nonnegative().optional(),
  afterCount: z.number().int().nonnegative().optional(),
  minimumIncrease: z.number().int().positive().optional(),
  observed: z.boolean(),
  confidence: z.number().min(0).max(1),
  recommended: z.boolean(),
  selected: z.boolean(),
  required: z.boolean(),
  rejectionReasons: z.array(z.string()).default([]),
});

export const EffectReconciliationSchema = z.object({
  status: z.enum(["stable", "timed-out", "legacy-insufficient"]),
  quietPeriodMs: z.number().int().positive(),
  maximumObservationMs: z.number().int().positive(),
  observedForMs: z.number().int().nonnegative(),
  mutationCount: z.number().int().nonnegative(),
  popupOpened: z.boolean(),
  popupClosed: z.boolean(),
  frameReplacementObserved: z.boolean(),
  pageContextReturned: z.boolean(),
  editorResetObserved: z.boolean(),
  reconciledAt: z.string().datetime(),
});

export const OutcomeVerificationSchema = z.enum([
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "UNVERIFIED",
]);

export const DemonstrationSessionSchema = z.object({
  id: z.string(),
  startedAt: z.string().datetime(),
  stoppedAt: z.string().datetime().optional(),
  pages: z.array(RecordedPageContextSchema),
  pageGraph: PageContextGraphSchema,
  actions: z.array(RecordedActionSchema),
  variables: z.array(WorkflowVariableSchema),
  beforeState: StructuralSnapshotSchema.optional(),
  afterState: StructuralSnapshotSchema.optional(),
  applicationStateBefore: ApplicationStateSchema.optional(),
  applicationStateAfter: ApplicationStateSchema.optional(),
  outcomeCandidates: z.array(ApplicationOutcomeCandidateSchema).default([]),
  outcomeVerification: OutcomeVerificationSchema.default("UNVERIFIED"),
  effectReconciliation: EffectReconciliationSchema.optional(),
  authenticationExcluded: z.literal(true),
});

export const LocatorStrategySchema = z.enum([
  "role-name",
  "label-association",
  "form-control-name",
  "form-control-prefix-ordinal",
  "container-role-name",
  "text-dom-relation",
  "form-ownership",
  "neighbor-label",
  "same-row-column",
  "canonical-href",
  "icon-evidence",
  "row-icon-context",
  "row-clickable-context",
  "stable-attribute",
  "structural-fallback",
  "bounding-box",
  "absolute-coordinate",
]);

export const LocatorRuleSchema = z.object({
  strategy: LocatorStrategySchema,
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  formControlName: z.string().optional(),
  formControlNamePrefix: z.string().optional(),
  ordinal: z.number().int().nonnegative().optional(),
  containerHeading: z.string().optional(),
  attribute: z.string().optional(),
  attributeValue: z.string().optional(),
  structuralPath: z.string().optional(),
  frameTitle: z.string().optional(),
  formName: z.string().optional(),
  tagName: z.string().optional(),
  staticText: z.string().optional(),
  canonicalHref: z.string().optional(),
  iconAlt: z.string().optional(),
  iconTitle: z.string().optional(),
  iconSrc: z.string().optional(),
  iconTag: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
  rowText: z.string().optional(),
  rowTexts: z.array(z.string()).max(12).optional(),
  rowIndex: z.number().int().nonnegative().optional(),
  columnIndex: z.number().int().nonnegative().optional(),
  columnHeader: z.string().optional(),
  sequencePreviousActionId: z.string().optional(),
  controlFamily:
    DemonstratedTargetDescriptorSchema.shape.controlFamily.optional(),
});

export const LocatorCandidateSchema = z.object({
  id: z.string(),
  strategy: LocatorStrategySchema,
  rule: LocatorRuleSchema,
  selectorPreview: z.string(),
  matchCount: z.number().int().nonnegative(),
  visibleCount: z.number().int().nonnegative(),
  enabledCount: z.number().int().nonnegative(),
  editableCount: z.number().int().nonnegative().optional(),
  typeCompatibleCount: z.number().int().nonnegative().default(0),
  unique: z.boolean(),
  confidence: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  explanation: z.string(),
  fallbackOrder: z.number().int().nonnegative(),
  demonstratedFingerprint: z.string(),
});

export const ConditionSchema = z.object({
  type: z.enum([
    "visible",
    "enabled",
    "editable",
    "value-equals",
    "text-visible",
    "text-absent",
    "page-open",
    "page-closed",
    "url-path",
    "backing-field-synchronized",
  ]),
  expected: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string(),
});

export const CompiledPageContextSchema = RecordedPageContextSchema.extend({
  resolutionOrder: z.array(
    z.enum([
      "opener",
      "origin-path",
      "title",
      "structural-fingerprint",
      "landmark",
      "page-role",
    ]),
  ),
});

export const CompiledStepSchema = z.object({
  id: z.string(),
  sourceActionId: z.string(),
  pageContextId: z.string(),
  action: RecordedActionTypeSchema,
  name: z.string(),
  target: DemonstratedTargetSchema.optional(),
  sequenceContext: DemonstratedSequenceContextSchema.optional(),
  locatorCandidates: z.array(LocatorCandidateSchema),
  selectedLocatorId: z.string().optional(),
  value: WorkflowActionValueSchema.optional(),
  outputVariable: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
  extractionSelection: ExtractionSelectionSchema.optional(),
  valueRef: z.string().optional(),
  localLiteral: z.string().optional(),
  valueTransforms: z.array(RuntimeValueTransformSchema).default([]),
  executionGuard: StepExecutionGuardSchema.optional(),
  inputStrategies: z
    .array(
      z.enum([
        "playwright-fill",
        "contenteditable-fill",
        "sequential-keys",
        "legacy-backing-sync",
        "native-value-setter",
      ]),
    )
    .min(1)
    .optional(),
  key: z.string().optional(),
  keyboardScope: z.enum(["focused-element", "page"]).optional(),
  optional: z.boolean(),
  preconditions: z.array(ConditionSchema),
  postconditions: z.array(ConditionSchema),
  expectsPopupContextId: z.string().optional(),
  expectsPopupClosure: z.boolean().optional(),
  semanticEnrichment: z
    .object({
      intention: z.string(),
      semanticTarget: z.string(),
      recommendedLocator: z
        .object({
          strategy: LocatorStrategySchema,
          selectorPreview: z.string(),
        })
        .optional(),
      postcondition: z.string().optional(),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
  inferred: z.boolean().default(false),
  evidenceRefs: z.array(z.string()).default([]),
});

export const LoopStopConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("no-next-eligible-item") }),
  z.object({
    type: z.literal("maximum-iterations"),
    maximum: z.number().int().min(1).max(1000),
  }),
  z.object({
    type: z.literal("maximum-duration-ms"),
    maximum: z.number().int().min(1000).max(3_600_000),
  }),
  z.object({ type: z.literal("duplicate-fingerprint") }),
  z.object({ type: z.literal("user-stop") }),
]);

export const CompiledLoopSchema = z.object({
  id: z.string(),
  collectionDescription: z.string(),
  templatePageContextId: z.string(),
  templateStepIds: z.array(z.string()).min(1),
  templateRowFingerprint: z.string(),
  nextItemRelationship: z.enum([
    "next-sibling",
    "next-row",
    "next-matching-container",
  ]),
  eligibilityPredicate: z.string(),
  stoppingConditions: z.array(LoopStopConditionSchema).min(4),
  maximumIterations: z.number().int().min(1).max(1000).default(100),
  maximumDurationMs: z.number().int().min(1000).max(3_600_000).default(600_000),
  duplicateItemProtection: z.boolean().default(true),
  errorPolicy: z.enum(["stop-first-required-failure", "continue-optional"]),
  executionScope: z.literal("workflow").default("workflow"),
});

export const OutcomeEvidenceSchema = z.object({
  type: z.enum([
    "text-visible",
    "element-visible",
    "field-value",
    "navigation",
    "popup-closed",
    "structural-marker",
    "relative-count-increase",
    "new-item-contains-variable",
    "editor-reset",
    "field-unchanged",
  ]),
  pageContextId: z.string(),
  target: z.string(),
  expected: z.union([z.string(), z.number(), z.boolean()]),
  sourceStepId: z.string().optional(),
  variableRef: z.string().optional(),
  required: z.boolean().default(true),
});

export const ApplicationOutcomeSchema = z.object({
  positiveEvidence: z.array(OutcomeEvidenceSchema).default([]),
  negativeEvidence: z
    .array(
      z.object({
        type: z.enum([
          "error-text",
          "error-marker",
          "unexpected-origin",
          "unexpected-popup",
          "closed-main-page",
          "unchanged-state",
        ]),
        target: z.string(),
        description: z.string(),
      }),
    )
    .min(1),
  requireAllPositive: z.boolean().default(true),
  verification: OutcomeVerificationSchema.default("UNVERIFIED"),
});

export const CompilationDiagnosticSchema = z.object({
  level: z.enum(["info", "warning", "error"]),
  code: z.string(),
  message: z.string(),
  actionId: z.string().optional(),
});

export const ContinuationConfirmationPolicySchema = z.object({
  mode: z.literal("accept-affirmative"),
  promptPhrase: z.literal("voulez-vous continuer"),
  affirmativeLabel: z.literal("oui"),
  maximumAcceptsPerRun: z.number().int().min(1).max(100).default(20),
  resumeStepId: z.string().optional(),
});

export const CompiledWorkflowSchema = z.object({
  schemaVersion: z.literal("2.0.0"),
  id: z.string(),
  version: z.string(),
  sourceDemonstrationId: z.string(),
  compileMode: z.enum([
    "direct-demonstration",
    "mock-ai-generalization",
    "live-gpt-generalization",
  ]),
  pageContexts: z.array(CompiledPageContextSchema),
  steps: z.array(CompiledStepSchema).min(1),
  loops: z.array(CompiledLoopSchema).default([]),
  variables: z.array(WorkflowVariableSchema),
  continuationConfirmationPolicy:
    ContinuationConfirmationPolicySchema.optional(),
  expectedOutcome: ApplicationOutcomeSchema,
  compilationMetadata: z.object({
    compiledAt: z.string().datetime(),
    promptVersion: z.string().optional(),
    model: z.string().optional(),
    modelCalls: z.number().int().nonnegative(),
    payloadSha256: z.string().optional(),
    diagnostics: z.array(CompilationDiagnosticSchema),
    generatedPlaywright: z.string(),
  }),
});

export const RuntimeStateSchema = z.enum([
  "Ready",
  "Running",
  "Passed",
  "CompletedUnverified",
  "Failed",
  "Stopped",
]);

export const RuntimeTelemetrySchema = z.object({
  workflowId: z.string(),
  runId: z.string(),
  mode: z.enum(["local", "animated"]),
  state: RuntimeStateSchema,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  llmCalls: z.literal(0),
  openAIRequests: z.literal(0),
  steps: z.array(
    z.object({
      stepId: z.string(),
      pageContextId: z.string(),
      action: RecordedActionTypeSchema,
      status: z.enum(["passed", "failed", "stopped", "skipped"]),
      durationMs: z.number().nonnegative(),
      locatorStrategy: LocatorStrategySchema.optional(),
      message: z.string(),
    }),
  ),
  outcomeChecks: z.array(
    z.object({
      type: z.string(),
      target: z.string(),
      expected: z.union([z.string(), z.number(), z.boolean()]),
      actual: z.union([z.string(), z.number(), z.boolean()]),
      passed: z.boolean(),
    }),
  ),
  extractionAudit: z
    .array(
      z.object({
        stepId: z.string(),
        pageContextId: z.string(),
        variableName: z.string().regex(/^[a-z][a-z0-9_]*$/),
        sourceFingerprint: z.string(),
        characterCount: z.number().int().nonnegative(),
        contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
        structuralSelectionReplayed: z.boolean(),
        numericCandidates: z.number().int().nonnegative().default(0),
        excludedNumericCandidates: z.number().int().nonnegative().default(0),
        eligibleNumberFound: z.boolean().default(false),
        keywordChecks: z
          .array(
            z.object({
              keyword: z.string(),
              matched: z.boolean(),
            }),
          )
          .default([]),
        rawTextPersisted: z.literal(false),
      }),
    )
    .default([]),
  loop: z
    .object({
      requestedIterations: z.number().int().positive(),
      completedIterations: z.number().int().nonnegative(),
      duplicateProtectionTriggered: z.boolean(),
    })
    .optional(),
  redactedLog: z.array(z.string()),
  error: z.string().optional(),
});

export type DemonstratedTarget = z.infer<typeof DemonstratedTargetSchema>;
export type DemonstratedTargetDescriptor = z.infer<
  typeof DemonstratedTargetDescriptorSchema
>;
export type RecordedPageContext = z.infer<typeof RecordedPageContextSchema>;
export type PageContextGraphData = z.infer<typeof PageContextGraphSchema>;
export type ObservedEffect = z.infer<typeof ObservedEffectSchema>;
export type RecordedAction = z.infer<typeof RecordedActionSchema>;
export type ExtractionSelection = z.infer<typeof ExtractionSelectionSchema>;
export type RuntimeValueTransform = z.infer<typeof RuntimeValueTransformSchema>;
export type StepExecutionGuard = z.infer<typeof StepExecutionGuardSchema>;
export type WorkflowVariable = z.infer<typeof WorkflowVariableSchema>;
export type DemonstrationSession = z.infer<typeof DemonstrationSessionSchema>;
export type ApplicationState = z.infer<typeof ApplicationStateSchema>;
export type ApplicationOutcomeCandidate = z.infer<
  typeof ApplicationOutcomeCandidateSchema
>;
export type LocatorRule = z.infer<typeof LocatorRuleSchema>;
export type LocatorCandidate = z.infer<typeof LocatorCandidateSchema>;
export type CompiledPageContext = z.infer<typeof CompiledPageContextSchema>;
export type CompiledStep = z.infer<typeof CompiledStepSchema>;
export type CompiledLoop = z.infer<typeof CompiledLoopSchema>;
export type ContinuationConfirmationPolicy = z.infer<
  typeof ContinuationConfirmationPolicySchema
>;
export type ApplicationOutcome = z.infer<typeof ApplicationOutcomeSchema>;
export type CompiledWorkflow = z.infer<typeof CompiledWorkflowSchema>;
export type RuntimeTelemetry = z.infer<typeof RuntimeTelemetrySchema>;

export function attachImplicitPopupOpeners(
  steps: CompiledStep[],
  pageContexts: Array<
    Pick<RecordedPageContext, "id" | "role" | "parentId" | "openerActionId">
  >,
) {
  for (const popupContext of pageContexts) {
    if (popupContext.role !== "popup") continue;
    if (steps.some((step) => step.expectsPopupContextId === popupContext.id))
      continue;
    const firstPopupStepIndex = steps.findIndex(
      (step) => step.pageContextId === popupContext.id,
    );
    if (firstPopupStepIndex < 0) continue;
    const precedingSteps = steps.slice(0, firstPopupStepIndex);
    const recordedOpener = popupContext.openerActionId
      ? precedingSteps.find(
          (step) => step.sourceActionId === popupContext.openerActionId,
        )
      : undefined;
    const opener =
      (recordedOpener?.action === "click" ? recordedOpener : undefined) ??
      [...precedingSteps]
        .reverse()
        .find(
          (step) =>
            step.action === "click" &&
            step.pageContextId !== popupContext.id &&
            (!popupContext.parentId ||
              step.pageContextId === popupContext.parentId),
        ) ??
      [...precedingSteps]
        .reverse()
        .find(
          (step) =>
            step.action === "click" && step.pageContextId !== popupContext.id,
        );
    if (opener) opener.expectsPopupContextId = popupContext.id;
  }
  return steps;
}
