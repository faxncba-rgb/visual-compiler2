import type {
  CompiledLoop,
  DemonstratedTarget,
  DemonstrationSession,
  LocatorCandidate,
} from "../../packages/demonstration-ir/src";

export function target(
  overrides: Partial<DemonstratedTarget> = {},
): DemonstratedTarget {
  return {
    fingerprint: "fnv1a-deadbeef",
    tag: "textarea",
    role: "textbox",
    accessibleName: "Texte de consultation",
    associatedLabel: "Texte de consultation",
    inputType: "textarea",
    editable: true,
    readonly: false,
    visible: true,
    enabled: true,
    semanticContainer: {
      tag: "section",
      heading: "Consultation",
      fingerprint: "fnv1a-container",
    },
    parent: { tag: "section" },
    nearbyVisibleLabels: ["Texte de consultation", "Date", "Heure"],
    rowColumnEvidence: [],
    frame: {
      role: "main",
      origin: "http://127.0.0.1:4273",
      pathname: "/fixture",
      structuralFingerprint: "frame-fingerprint",
    },
    descriptor: {
      controlFamily: "multiline-text",
      multiline: true,
      editable: true,
      actionCompatibility: ["fill"],
      tag: "textarea",
      role: "textbox",
      accessibleName: "Texte de consultation",
      associatedLabel: "Texte de consultation",
      hasOnclick: false,
      rawTargetPromoted: false,
      semanticContainer: {
        tag: "section",
        heading: "Consultation",
      },
      neighboringLabels: ["Texte de consultation", "Date", "Heure"],
      precedingLabels: ["Texte de consultation"],
      relatedActionName: "Enregistrer",
      frame: {
        role: "main",
        origin: "http://127.0.0.1:4273",
        pathname: "/fixture",
      },
    },
    stableAttributes: {
      name: "consultation",
      "data-vc-field": "consultation",
    },
    unstableAttributes: ["id", "class"],
    structuralPath: "html > body > form > section:nth-of-type(3) > textarea",
    editorAdapter: "playwright-fill",
    captureValidation: {
      exactTargetConnected: true,
      roleNameMatchCount: 1,
      labelMatchCount: 1,
      stableAttributeMatchCount: 1,
    },
    captureContext: {
      transient: false,
    },
    ...overrides,
  };
}

export function candidate(
  overrides: Partial<LocatorCandidate> = {},
): LocatorCandidate {
  return {
    id: "locator-1",
    strategy: "role-name",
    rule: {
      strategy: "role-name",
      role: "textbox",
      name: "Texte de consultation",
    },
    selectorPreview:
      'getByRole("textbox", { name: "Texte de consultation", exact: true })',
    matchCount: 1,
    visibleCount: 1,
    enabledCount: 1,
    editableCount: 1,
    typeCompatibleCount: 1,
    unique: true,
    confidence: 0.98,
    stability: 0.96,
    explanation: "Exact demonstrated target.",
    fallbackOrder: 0,
    demonstratedFingerprint: "fnv1a-deadbeef",
    ...overrides,
  };
}

export function session(): DemonstrationSession {
  const page = {
    id: "page-main",
    pageId: "browser-page-main",
    documentOrdinal: 1,
    role: "main" as const,
    origin: "http://127.0.0.1:4273",
    pathname: "/fixture",
    titlePattern: "Synthetic fixture",
    structuralFingerprint: "page-structure",
    pageRole: "main-application",
    sameOriginInspectable: true,
    status: "open" as const,
  };
  return {
    id: "demo-1",
    startedAt: "2026-07-26T10:00:00.000Z",
    stoppedAt: "2026-07-26T10:01:00.000Z",
    pages: [page],
    pageGraph: { rootId: page.id, nodes: [page], edges: [] },
    actions: [
      {
        id: "action-fill",
        pageContextId: page.id,
        action: "fill",
        name: "Main page — filled consultation editor",
        target: target(),
        valueRef: "{{consultation_text}}",
        observedEffects: [],
        timestampOffsetMs: 100,
        optional: false,
      },
      {
        id: "action-assert",
        pageContextId: page.id,
        action: "assert",
        name: "Main page — success state observed",
        observedEffects: [
          {
            type: "success-visible",
            pageContextId: page.id,
            fingerprint: "success-fingerprint",
            description: "Consultation synthétique enregistrée.",
          },
        ],
        timestampOffsetMs: 500,
        optional: false,
      },
    ],
    variables: [
      {
        id: "variable-1",
        name: "consultation_text",
        valueType: "string",
        sourceActionId: "action-fill",
        privacy: "local-variable",
        required: true,
      },
    ],
    outcomeVerification: "PARTIALLY_VERIFIED",
    outcomeCandidates: [],
    authenticationExcluded: true,
  };
}

export function loop(overrides: Partial<CompiledLoop> = {}): CompiledLoop {
  return {
    id: "loop-1",
    collectionDescription: "Eligible rows",
    templatePageContextId: "page-main",
    templateStepIds: ["step-1"],
    templateRowFingerprint: "row-template",
    nextItemRelationship: "next-row",
    eligibilityPredicate: "row is enabled",
    stoppingConditions: [
      { type: "no-next-eligible-item" },
      { type: "maximum-iterations", maximum: 100 },
      { type: "maximum-duration-ms", maximum: 600_000 },
      { type: "duplicate-fingerprint" },
      { type: "user-stop" },
    ],
    maximumIterations: 100,
    maximumDurationMs: 600_000,
    duplicateItemProtection: true,
    errorPolicy: "stop-first-required-failure",
    executionScope: "workflow",
    ...overrides,
  };
}
