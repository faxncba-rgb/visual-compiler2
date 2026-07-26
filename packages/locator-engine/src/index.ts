import type { Frame, Locator, Page } from "playwright";
import {
  LocatorCandidateSchema,
  type DemonstratedTarget,
  type LocatorCandidate,
  type LocatorRule,
} from "../../demonstration-ir/src";
import { createId, escapeForAttribute } from "../../shared/src";

export type LocatorRoot = Page | Frame;

const strategyWeight: Record<LocatorCandidate["strategy"], number> = {
  "role-name": 1,
  "label-association": 0.97,
  "form-control-name": 0.9,
  "container-role-name": 0.92,
  "text-dom-relation": 0.82,
  "form-ownership": 0.8,
  "neighbor-label": 0.76,
  "same-row-column": 0.68,
  "stable-attribute": 0.72,
  "structural-fallback": 0.5,
  "bounding-box": 0.2,
  "absolute-coordinate": 0.02,
};

function baseCandidate(
  target: DemonstratedTarget,
  rule: LocatorRule,
  selectorPreview: string,
  confidence: number,
  stability: number,
  explanation: string,
  fallbackOrder: number,
): LocatorCandidate {
  return {
    id: createId("locator"),
    strategy: rule.strategy,
    rule,
    selectorPreview,
    matchCount: 0,
    visibleCount: 0,
    enabledCount: 0,
    editableCount: 0,
    unique: false,
    confidence,
    stability,
    explanation,
    fallbackOrder,
    demonstratedFingerprint: target.fingerprint,
  };
}

export function generateLocatorCandidates(target: DemonstratedTarget) {
  const candidates: LocatorCandidate[] = [];
  let order = 0;
  if (target.role && target.accessibleName) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "role-name",
          role: target.role,
          name: target.accessibleName,
          ...(target.frame.title ? { frameTitle: target.frame.title } : {}),
        },
        `getByRole(${JSON.stringify(target.role)}, { name: ${JSON.stringify(target.accessibleName)}, exact: true })`,
        0.98,
        0.96,
        "Exact demonstrated accessibility role and accessible name.",
        order++,
      ),
    );
  }
  if (target.associatedLabel) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "label-association",
          label: target.associatedLabel,
          ...(target.frame.title ? { frameTitle: target.frame.title } : {}),
        },
        `getByLabel(${JSON.stringify(target.associatedLabel)}, { exact: true })`,
        0.97,
        0.95,
        "Exact label association captured from the demonstrated control.",
        order++,
      ),
    );
  }
  const formControlName = target.stableAttributes.name;
  if (formControlName) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "form-control-name",
          formControlName,
          ...(target.frame.title ? { frameTitle: target.frame.title } : {}),
        },
        `[name="${escapeForAttribute(formControlName)}"]`,
        0.91,
        0.88,
        "Stable form-control name with demonstrated type compatibility.",
        order++,
      ),
    );
  }
  if (
    target.semanticContainer?.heading &&
    target.role &&
    target.accessibleName
  ) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "container-role-name",
          role: target.role,
          name: target.accessibleName,
          containerHeading: target.semanticContainer.heading,
          ...(target.frame.title ? { frameTitle: target.frame.title } : {}),
        },
        `container(${JSON.stringify(target.semanticContainer.heading)}).getByRole(${JSON.stringify(target.role)}, { name: ${JSON.stringify(target.accessibleName)} })`,
        0.95,
        0.94,
        "Semantic container heading plus exact role/name.",
        order++,
      ),
    );
  }
  for (const attribute of ["data-vc-field", "data-vc-action", "data-testid"]) {
    const attributeValue = target.stableAttributes[attribute];
    if (!attributeValue) continue;
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "stable-attribute",
          attribute,
          attributeValue,
          ...(target.frame.title ? { frameTitle: target.frame.title } : {}),
        },
        `[${attribute}="${escapeForAttribute(attributeValue)}"]`,
        0.89,
        0.86,
        `Stable application attribute ${attribute} captured on the demonstrated element.`,
        order++,
      ),
    );
  }
  if (target.semanticContainer?.heading && target.structuralPath) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "structural-fallback",
          containerHeading: target.semanticContainer.heading,
          structuralPath: target.structuralPath,
          ...(target.frame.title ? { frameTitle: target.frame.title } : {}),
        },
        target.structuralPath,
        0.61,
        0.52,
        "Structural fallback retained only inside the demonstrated semantic container.",
        order++,
      ),
    );
  }
  return candidates;
}

export function locatorForRule(root: LocatorRoot, rule: LocatorRule): Locator {
  if (rule.strategy === "role-name") {
    if (!rule.role || !rule.name)
      throw new Error("Role/name locator is incomplete.");
    return root.getByRole(rule.role as never, {
      name: rule.name,
      exact: true,
    });
  }
  if (rule.strategy === "label-association") {
    if (!rule.label) throw new Error("Label locator is incomplete.");
    return root.getByLabel(rule.label, { exact: true });
  }
  if (rule.strategy === "form-control-name") {
    if (!rule.formControlName)
      throw new Error("Form-control locator is incomplete.");
    return root.locator(`[name="${escapeForAttribute(rule.formControlName)}"]`);
  }
  if (rule.strategy === "container-role-name") {
    if (!rule.containerHeading || !rule.role || !rule.name)
      throw new Error("Container role/name locator is incomplete.");
    const heading = root.getByRole("heading", {
      name: rule.containerHeading,
      exact: true,
    });
    return root
      .locator("section,form,article,[role=dialog],[role=region]")
      .filter({ has: heading })
      .getByRole(rule.role as never, { name: rule.name, exact: true });
  }
  if (rule.strategy === "stable-attribute") {
    if (!rule.attribute || !rule.attributeValue)
      throw new Error("Stable-attribute locator is incomplete.");
    return root.locator(
      `[${rule.attribute}="${escapeForAttribute(rule.attributeValue)}"]`,
    );
  }
  if (rule.strategy === "structural-fallback") {
    if (!rule.structuralPath)
      throw new Error("Structural locator is incomplete.");
    if (!rule.containerHeading) return root.locator(rule.structuralPath);
    const heading = root.getByRole("heading", {
      name: rule.containerHeading,
      exact: true,
    });
    return root
      .locator("section,form,article,[role=dialog],[role=region]")
      .filter({ has: heading })
      .locator(rule.structuralPath);
  }
  throw new Error(`Locator strategy ${rule.strategy} is not executable.`);
}

async function editableCount(locator: Locator) {
  const count = await locator.count();
  let editable = 0;
  for (let index = 0; index < count; index += 1) {
    if (
      await locator
        .nth(index)
        .isEditable()
        .catch(() => false)
    )
      editable += 1;
  }
  return editable;
}

export async function validateLocatorCandidates(
  root: LocatorRoot,
  target: DemonstratedTarget,
  candidates = generateLocatorCandidates(target),
) {
  const validated: LocatorCandidate[] = [];
  for (const candidate of candidates) {
    const locator = locatorForRule(root, candidate.rule);
    const matchCount = await locator.count().catch(() => 0);
    let visibleCount = 0;
    let enabledCount = 0;
    for (let index = 0; index < matchCount; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) visibleCount += 1;
      if (await item.isEnabled().catch(() => false)) enabledCount += 1;
    }
    validated.push(
      LocatorCandidateSchema.parse({
        ...candidate,
        matchCount,
        visibleCount,
        enabledCount,
        editableCount: await editableCount(locator),
        unique: matchCount === 1,
      }),
    );
  }
  return rankLocatorCandidates(validated);
}

export function validateCapturedLocatorCandidates(
  target: DemonstratedTarget,
  candidates = generateLocatorCandidates(target),
) {
  return rankLocatorCandidates(
    candidates.map((candidate) => {
      const matchCount =
        candidate.strategy === "role-name" ||
        candidate.strategy === "container-role-name"
          ? target.captureValidation.roleNameMatchCount
          : candidate.strategy === "label-association"
            ? target.captureValidation.labelMatchCount
            : ["form-control-name", "stable-attribute"].includes(
                  candidate.strategy,
                )
              ? target.captureValidation.stableAttributeMatchCount
              : 1;
      return LocatorCandidateSchema.parse({
        ...candidate,
        matchCount,
        visibleCount: matchCount === 1 && target.visible ? 1 : 0,
        enabledCount: matchCount === 1 && target.enabled ? 1 : 0,
        editableCount: matchCount === 1 && target.editable ? 1 : 0,
        unique: matchCount === 1,
        explanation: `${candidate.explanation} Revalidated from capture-time evidence because the transient context had closed.`,
      });
    }),
  );
}

export function rankLocatorCandidates(candidates: LocatorCandidate[]) {
  return [...candidates].sort((left, right) => {
    const score = (candidate: LocatorCandidate) =>
      candidate.confidence * 0.34 +
      candidate.stability * 0.28 +
      strategyWeight[candidate.strategy] * 0.18 +
      (candidate.unique ? 0.14 : 0) +
      (candidate.visibleCount === 1 ? 0.03 : 0) +
      (candidate.enabledCount === 1 ? 0.03 : 0);
    return score(right) - score(left);
  });
}

export function selectDemonstratedLocator(
  candidates: LocatorCandidate[],
  options: { requireEditable?: boolean; confidenceThreshold?: number } = {},
) {
  const best = rankLocatorCandidates(candidates).find(
    (candidate) =>
      candidate.unique &&
      candidate.visibleCount === 1 &&
      candidate.enabledCount === 1 &&
      (!options.requireEditable || candidate.editableCount === 1) &&
      candidate.strategy !== "absolute-coordinate" &&
      candidate.confidence >= (options.confidenceThreshold ?? 0.7),
  );
  if (!best) {
    throw new Error(
      "Compilation rejected: no unique, visible, enabled, type-compatible locator preserves the demonstrated target.",
    );
  }
  return best;
}
