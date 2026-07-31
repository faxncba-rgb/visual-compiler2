import type { Frame, Locator, Page } from "playwright";
import {
  LocatorCandidateSchema,
  type DemonstratedTarget,
  type DemonstratedTargetDescriptor,
  type LocatorCandidate,
  type LocatorRule,
  type RecordedAction,
} from "../../demonstration-ir/src";
import { createId, escapeForAttribute } from "../../shared/src";

export type LocatorRoot = Page | Frame;

export type LocatorValidationEvidence = {
  stepId: string;
  actionIndex: number;
  recordedTargetFamily: string;
  normalizedActionableAncestorFamily: string;
  actionCompatibility: string[];
  rawTargetPromoted: boolean;
  accessibleNamePresent: boolean;
  normalizedStaticTextPresent: boolean;
  semanticContainerMatchCount: number;
  sameFormMatchCount: number;
  candidateCounts: {
    total: number;
    visible: number;
    enabled: number;
    editable: number;
    typeCompatible: number;
  };
  rejectionReasonsByStrategy: Array<{
    strategy: LocatorCandidate["strategy"];
    selectorPreview: string;
    reasons: string[];
  }>;
  originalDomNodeReplaced: boolean;
  semanticEquivalentFound: boolean;
};

export class LocatorValidationError extends Error {
  readonly name = "LocatorValidationError";

  constructor(readonly evidence: LocatorValidationEvidence) {
    super(
      "Compilation rejected: no unique, visible, enabled, type-compatible locator preserves the demonstrated target.",
    );
  }
}

const strategyWeight: Record<LocatorCandidate["strategy"], number> = {
  "role-name": 1,
  "label-association": 0.97,
  "form-control-name": 0.9,
  "container-role-name": 0.92,
  "text-dom-relation": 0.98,
  "form-ownership": 0.9,
  "neighbor-label": 0.76,
  "same-row-column": 0.68,
  "canonical-href": 0.96,
  "icon-evidence": 0.94,
  "row-icon-context": 0.98,
  "row-clickable-context": 0.96,
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
    typeCompatibleCount: 0,
    unique: false,
    confidence,
    stability,
    explanation,
    fallbackOrder,
    demonstratedFingerprint: target.fingerprint,
  };
}

export function generateLocatorCandidates(
  target: DemonstratedTarget,
  sequenceContext?: RecordedAction["sequenceContext"],
) {
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
          ...(target.frame.role !== "main" && target.frame.title
            ? { frameTitle: target.frame.title }
            : {}),
        },
        `getByRole(${JSON.stringify(target.role)}, { name: ${JSON.stringify(target.accessibleName)}, exact: true })`,
        0.98,
        0.96,
        "Exact demonstrated accessibility role and accessible name.",
        order++,
      ),
    );
  }
  if (target.descriptor?.normalizedStaticText) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "text-dom-relation",
          tagName: target.descriptor.tag,
          staticText: target.descriptor.normalizedStaticText,
          ...(target.frame.role !== "main" && target.frame.title
            ? { frameTitle: target.frame.title }
            : {}),
        },
        `${target.descriptor.tag}:text-is(${JSON.stringify(target.descriptor.normalizedStaticText)})`,
        0.96,
        0.93,
        "Exact normalized static text on the demonstrated actionable ancestor.",
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
          ...(target.frame.role !== "main" && target.frame.title
            ? { frameTitle: target.frame.title }
            : {}),
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
          ...(target.frame.role !== "main" && target.frame.title
            ? { frameTitle: target.frame.title }
            : {}),
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
          ...(target.frame.role !== "main" && target.frame.title
            ? { frameTitle: target.frame.title }
            : {}),
        },
        `container(${JSON.stringify(target.semanticContainer.heading)}).getByRole(${JSON.stringify(target.role)}, { name: ${JSON.stringify(target.accessibleName)} })`,
        0.95,
        0.94,
        "Semantic container heading plus exact role/name.",
        order++,
      ),
    );
  }
  if (target.descriptor?.formName) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "form-ownership",
          formName: target.descriptor.formName,
          controlFamily: target.descriptor.controlFamily,
          staticText: target.descriptor.normalizedStaticText,
          ...(sequenceContext?.previousActionId
            ? { sequencePreviousActionId: sequenceContext.previousActionId }
            : {}),
          ...(target.frame.role !== "main" && target.frame.title
            ? { frameTitle: target.frame.title }
            : {}),
        },
        `form[name=${JSON.stringify(target.descriptor.formName)}] ${target.descriptor.controlFamily}`,
        sequenceContext?.sameForm ? 0.97 : 0.88,
        sequenceContext?.sameForm ? 0.96 : 0.9,
        sequenceContext?.sameForm
          ? "Same demonstrated form as the preceding input action, exact static text, and compatible control family."
          : "Stable form ownership plus demonstrated control family.",
        order++,
      ),
    );
  }
  const click = target.clickEvidence;
  if (click?.canonicalHref) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "canonical-href",
          canonicalHref: click.canonicalHref,
          ...(click.icon?.alt ? { iconAlt: click.icon.alt } : {}),
          ...(click.icon?.title ? { iconTitle: click.icon.title } : {}),
          ...(click.icon?.src ? { iconSrc: click.icon.src } : {}),
        },
        `link[href=${JSON.stringify(click.canonicalHref)}]`,
        0.97,
        0.95,
        "Canonical query-free href captured on the demonstrated clickable ancestor.",
        order++,
      ),
    );
  }
  if (click?.icon && (click.icon.alt || click.icon.title || click.icon.src)) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "icon-evidence",
          ...(click.icon.alt ? { iconAlt: click.icon.alt } : {}),
          ...(click.icon.title ? { iconTitle: click.icon.title } : {}),
          ...(click.icon.src ? { iconSrc: click.icon.src } : {}),
          ...(click.canonicalHref
            ? { canonicalHref: click.canonicalHref }
            : {}),
        },
        `clickable:has(icon[alt=${JSON.stringify(click.icon.alt ?? "")}])`,
        0.95,
        0.93,
        "Raw icon identity retained together with its normalized clickable ancestor.",
        order++,
      ),
    );
  }
  const stableRowTexts = click?.table?.rowText.filter(Boolean) ?? [];
  const stableRowText = stableRowTexts[0];
  const hasNamedIconEvidence = Boolean(
    click?.icon && (click.icon.alt || click.icon.title || click.icon.src),
  );
  const hasAnonymousStructuralIconEvidence = Boolean(
    click?.icon && click.canonicalHref && target.descriptor?.rawTargetPromoted,
  );
  if (
    click?.table &&
    stableRowText &&
    click.icon &&
    click.canonicalHref &&
    (hasNamedIconEvidence || hasAnonymousStructuralIconEvidence)
  ) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "row-icon-context",
          rowText: stableRowText,
          rowTexts: stableRowTexts,
          rowIndex: click.table.rowIndex,
          columnIndex: click.table.columnIndex,
          iconTag: click.icon.tag,
          ...(click.table.headers[click.table.columnIndex]
            ? {
                columnHeader: click.table.headers[click.table.columnIndex],
              }
            : {}),
          ...(click.icon.alt ? { iconAlt: click.icon.alt } : {}),
          ...(click.icon.title ? { iconTitle: click.icon.title } : {}),
          ...(click.icon.src ? { iconSrc: click.icon.src } : {}),
          ...(click.canonicalHref
            ? { canonicalHref: click.canonicalHref }
            : {}),
        },
        `row(<captured-structure>).cell(${click.table.columnIndex}).clickable-icon`,
        0.99,
        0.97,
        hasNamedIconEvidence
          ? "Table row content, column header, icon identity and canonical link agree."
          : "Table row content, demonstrated column, anonymous icon tag and canonical link agree.",
        order++,
      ),
    );
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "same-row-column",
          rowIndex: click.table.rowIndex,
          columnIndex: click.table.columnIndex,
          ...(click.table.headers[click.table.columnIndex]
            ? {
                columnHeader: click.table.headers[click.table.columnIndex],
              }
            : {}),
          ...(click.form?.name ? { formName: click.form.name } : {}),
          ...(click.icon.alt ? { iconAlt: click.icon.alt } : {}),
          ...(click.icon.title ? { iconTitle: click.icon.title } : {}),
          ...(click.icon.src ? { iconSrc: click.icon.src } : {}),
          ...(click.canonicalHref
            ? { canonicalHref: click.canonicalHref }
            : {}),
        },
        `table.row(${click.table.rowIndex}).cell(${click.table.columnIndex}).clickable-icon`,
        0.83,
        0.72,
        "Table-local demonstrated row and column, icon identity and canonical link agree without depending on mutable row text.",
        order++,
      ),
    );
  }
  if (click?.table && stableRowText && !click.icon && click.canonicalHref) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "row-clickable-context",
          rowText: stableRowText,
          rowTexts: stableRowTexts,
          rowIndex: click.table.rowIndex,
          columnIndex: click.table.columnIndex,
          ...(click.table.headers[click.table.columnIndex]
            ? {
                columnHeader: click.table.headers[click.table.columnIndex],
              }
            : {}),
          ...(click.form?.name ? { formName: click.form.name } : {}),
          canonicalHref: click.canonicalHref,
        },
        `row(<captured-structure>).cell(${click.table.columnIndex}).clickable`,
        0.98,
        0.96,
        "Table row content, demonstrated column and canonical link identify the promoted clickable ancestor.",
        order++,
      ),
    );
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "same-row-column",
          rowIndex: click.table.rowIndex,
          columnIndex: click.table.columnIndex,
          ...(click.table.headers[click.table.columnIndex]
            ? {
                columnHeader: click.table.headers[click.table.columnIndex],
              }
            : {}),
          ...(click.form?.name ? { formName: click.form.name } : {}),
          canonicalHref: click.canonicalHref,
        },
        `table.row(${click.table.rowIndex}).cell(${click.table.columnIndex}).clickable`,
        0.82,
        0.72,
        "Table-local demonstrated row and column plus canonical link remain deterministic when row text changes.",
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
          ...(target.frame.role !== "main" && target.frame.title
            ? { frameTitle: target.frame.title }
            : {}),
        },
        `[${attribute}="${escapeForAttribute(attributeValue)}"]`,
        0.89,
        0.86,
        `Stable application attribute ${attribute} captured on the demonstrated element.`,
        order++,
      ),
    );
  }
  if (
    target.structuralPath &&
    target.captureValidation.exactTargetConnected &&
    target.descriptor?.actionCompatibility.includes("extract")
  ) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "structural-fallback",
          structuralPath: target.structuralPath,
          ...(target.frame.role !== "main" && target.frame.title
            ? { frameTitle: target.frame.title }
            : {}),
        },
        target.structuralPath,
        0.9,
        0.86,
        "Exact connected extraction zone retained from the demonstrated popup structure.",
        order++,
      ),
    );
  }
  if (
    target.frame.role === "same-origin" &&
    target.tag === "body" &&
    target.role === "textbox" &&
    target.editable &&
    target.structuralPath
  ) {
    candidates.push(
      baseCandidate(
        target,
        {
          strategy: "structural-fallback",
          structuralPath: target.structuralPath,
          ...(target.frame.title ? { frameTitle: target.frame.title } : {}),
        },
        target.structuralPath,
        0.94,
        0.92,
        "Unique editable document root inside the demonstrated inspectable editor frame.",
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
          ...(target.frame.role !== "main" && target.frame.title
            ? { frameTitle: target.frame.title }
            : {}),
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
  if (rule.strategy === "text-dom-relation") {
    if (!rule.tagName || !rule.staticText)
      throw new Error("Exact-text locator is incomplete.");
    return root
      .locator(rule.tagName)
      .filter({ hasText: exactStaticTextPattern(rule.staticText) });
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
  if (rule.strategy === "form-ownership") {
    if (!rule.formName || !rule.controlFamily)
      throw new Error("Form-ownership locator is incomplete.");
    const selectors: Record<
      DemonstratedTargetDescriptor["controlFamily"],
      string
    > = {
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
    const locator = root
      .locator(`form[name="${escapeForAttribute(rule.formName)}"]`)
      .locator(selectors[rule.controlFamily]);
    return rule.staticText
      ? locator.filter({ hasText: exactStaticTextPattern(rule.staticText) })
      : locator;
  }
  if (
    rule.strategy === "canonical-href" ||
    rule.strategy === "icon-evidence" ||
    rule.strategy === "row-icon-context" ||
    rule.strategy === "row-clickable-context" ||
    rule.strategy === "same-row-column"
  ) {
    const hrefSelector = rule.canonicalHref
      ? canonicalHrefSelector(rule.canonicalHref)
      : "a[href],a[onclick],[role=link]";
    const iconSelector = iconEvidenceSelector(rule);
    let scope: Locator = root.locator(hrefSelector);
    if (
      rule.strategy === "row-icon-context" ||
      rule.strategy === "row-clickable-context" ||
      rule.strategy === "same-row-column"
    ) {
      const usesSemanticRow =
        rule.strategy === "row-icon-context" ||
        rule.strategy === "row-clickable-context";
      const rowTexts =
        usesSemanticRow && rule.rowTexts && rule.rowTexts.length > 0
          ? rule.rowTexts
          : usesSemanticRow && rule.rowText
            ? [rule.rowText]
            : [];
      if (rowTexts.length === 0 && rule.rowIndex === undefined)
        throw new Error("Row/icon locator is missing a demonstrated row.");
      let row: Locator;
      if (rule.strategy === "same-row-column") {
        let table = rule.formName
          ? root
              .locator(`form[name="${escapeForAttribute(rule.formName)}"]`)
              .locator("table")
          : root.locator("table");
        table = table.filter({ has: root.locator(hrefSelector) });
        if (rule.columnHeader && rule.columnIndex !== undefined) {
          const headerCell = root
            .locator(`tr > :is(th,td):nth-child(${rule.columnIndex + 1})`)
            .filter({
              hasText: exactStaticTextPattern(rule.columnHeader),
            });
          table = table.filter({ has: headerCell });
        }
        row = table.locator("tr").nth(rule.rowIndex!);
      } else {
        row = root.locator("tr");
        for (const rowText of rowTexts) row = row.filter({ hasText: rowText });
        if (rowTexts.length === 0 && rule.rowIndex !== undefined)
          row = row.nth(rule.rowIndex);
      }
      const rowScope =
        rule.columnIndex === undefined
          ? row
          : row.locator(":scope > th, :scope > td").nth(rule.columnIndex);
      scope = rowScope.locator(hrefSelector);
    }
    return iconSelector
      ? scope.filter({ has: root.locator(iconSelector) })
      : scope;
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

function canonicalHrefSelector(value: string) {
  const url = new URL(value);
  const pathname = escapeForAttribute(url.pathname || "/");
  const canonical = escapeForAttribute(`${url.origin}${url.pathname || "/"}`);
  const basename = url.pathname.split("/").filter(Boolean).at(-1);
  const selectors = [
    `a[href^="${pathname}"]`,
    `a[href^="${canonical}"]`,
    ...(basename
      ? [
          `a[href^="${escapeForAttribute(basename)}"]`,
          `a[href^="./${escapeForAttribute(basename)}"]`,
        ]
      : []),
  ];
  return selectors.join(",");
}

function iconEvidenceSelector(rule: LocatorRule) {
  if (rule.iconAlt)
    return `img[alt="${escapeForAttribute(rule.iconAlt)}"],[role="img"][aria-label="${escapeForAttribute(rule.iconAlt)}"]`;
  if (rule.iconTitle)
    return `img[title="${escapeForAttribute(rule.iconTitle)}"],[role="img"][title="${escapeForAttribute(rule.iconTitle)}"]`;
  if (rule.iconSrc) {
    const url = new URL(rule.iconSrc);
    const pathname = escapeForAttribute(url.pathname || "/");
    const canonical = escapeForAttribute(`${url.origin}${url.pathname || "/"}`);
    return `img[src^="${pathname}"],img[src^="${canonical}"]`;
  }
  if (rule.iconTag && /^[a-z][a-z0-9-]*$/.test(rule.iconTag))
    return rule.iconTag;
  return undefined;
}

function exactStaticTextPattern(value: string) {
  const normalized = value.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  return new RegExp(`^\\s*${normalized}\\s*$`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function editableCount(locator: Locator) {
  const count = await locator.count().catch(() => 0);
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

function inferredControlFamily(
  target: DemonstratedTarget,
): DemonstratedTargetDescriptor["controlFamily"] {
  const tag = target.tag.toLowerCase();
  const role = target.role?.toLowerCase();
  if (
    tag === "textarea" ||
    ["contenteditable", "legacy-facade"].includes(target.editorAdapter ?? "")
  )
    return "multiline-text";
  if (tag === "select" || ["combobox", "listbox"].includes(role ?? ""))
    return "selection";
  if (
    ["checkbox", "radio"].includes(target.inputType?.toLowerCase() ?? "") ||
    ["checkbox", "radio", "switch"].includes(role ?? "")
  )
    return "toggle";
  if (tag === "button" || role === "button") return "button";
  if (tag === "a" || role === "link") return "link";
  if (tag === "input" || role === "textbox") return "single-line-text";
  return "other";
}

async function typeCompatibleCount(
  locator: Locator,
  family: DemonstratedTargetDescriptor["controlFamily"],
) {
  const count = await locator.count().catch(() => 0);
  let compatible = 0;
  for (let index = 0; index < count; index += 1) {
    const matches = await locator
      .nth(index)
      .evaluate((element, expectedFamily) => {
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute("role")?.toLowerCase();
        const inputType =
          element instanceof HTMLInputElement
            ? element.type.toLowerCase()
            : undefined;
        const contenteditable = element.getAttribute("contenteditable");
        if (expectedFamily === "multiline-text")
          return (
            tag === "textarea" ||
            (contenteditable === "true" && (!role || role === "textbox"))
          );
        if (expectedFamily === "single-line-text")
          return (
            tag === "input" &&
            !["hidden", "password", "checkbox", "radio"].includes(
              inputType ?? "",
            )
          );
        if (expectedFamily === "selection")
          return tag === "select" || role === "combobox" || role === "listbox";
        if (expectedFamily === "toggle")
          return (
            ["checkbox", "radio"].includes(inputType ?? "") ||
            ["checkbox", "radio", "switch"].includes(role ?? "")
          );
        if (expectedFamily === "button")
          return tag === "button" || role === "button";
        if (expectedFamily === "link") return tag === "a" || role === "link";
        return true;
      }, family)
      .catch(() => false);
    if (matches) compatible += 1;
  }
  return compatible;
}

export async function validateLocatorCandidates(
  root: LocatorRoot,
  target: DemonstratedTarget,
  candidates = generateLocatorCandidates(target),
) {
  const controlFamily =
    target.descriptor?.controlFamily ?? inferredControlFamily(target);
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
        typeCompatibleCount: await typeCompatibleCount(locator, controlFamily),
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
            : candidate.strategy === "canonical-href"
              ? (target.clickEvidence?.captureValidation
                  .canonicalHrefMatchCount ?? 0)
              : candidate.strategy === "icon-evidence"
                ? (target.clickEvidence?.captureValidation.iconMatchCount ?? 0)
                : candidate.strategy === "row-icon-context"
                  ? capturedRowContextMatchCount(target)
                  : candidate.strategy === "row-clickable-context"
                    ? capturedRowClickableMatchCount(target)
                    : candidate.strategy === "same-row-column"
                      ? target.clickEvidence?.icon
                        ? capturedRowContextMatchCount(target)
                        : capturedRowClickableMatchCount(target)
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
        typeCompatibleCount: matchCount === 1 ? 1 : 0,
        unique: matchCount === 1,
        explanation: `${candidate.explanation} Revalidated from capture-time evidence because the transient context had closed.`,
      });
    }),
  );
}

function capturedRowContextMatchCount(target: DemonstratedTarget) {
  const click = target.clickEvidence;
  const recordedCount = click?.captureValidation.rowIconMatchCount ?? 0;
  if (recordedCount > 0) return recordedCount;
  const icon = click?.icon;
  const hasNamedIconEvidence = Boolean(
    icon && (icon.alt || icon.title || icon.src),
  );
  if (
    !hasNamedIconEvidence &&
    icon?.tag &&
    click?.canonicalHref &&
    click.table?.rowText.some(Boolean) &&
    target.captureValidation.exactTargetConnected &&
    target.descriptor?.rawTargetPromoted
  )
    return 1;
  return 0;
}

function capturedRowClickableMatchCount(target: DemonstratedTarget) {
  const click = target.clickEvidence;
  const recordedCount = click?.captureValidation.rowClickableMatchCount ?? 0;
  if (recordedCount > 0) return recordedCount;
  if (
    click?.canonicalHref &&
    click.table?.rowText.some(Boolean) &&
    target.captureValidation.exactTargetConnected &&
    target.descriptor?.rawTargetPromoted
  )
    return 1;
  return 0;
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
  options: {
    requireEditable?: boolean;
    confidenceThreshold?: number;
    target?: DemonstratedTarget;
    action?: RecordedAction["action"];
    originalDomNodeReplaced?: boolean;
    semanticEquivalentFound?: boolean;
    stepId?: string;
    actionIndex?: number;
  } = {},
) {
  const actionCompatible =
    !options.target?.descriptor ||
    !options.action ||
    options.target.descriptor.actionCompatibility.includes(
      options.action as never,
    );
  const best = rankLocatorCandidates(candidates).find(
    (candidate) =>
      actionCompatible &&
      candidate.unique &&
      candidate.visibleCount === 1 &&
      candidate.enabledCount === 1 &&
      (!options.requireEditable || candidate.editableCount === 1) &&
      candidate.typeCompatibleCount === 1 &&
      candidate.strategy !== "absolute-coordinate" &&
      candidate.confidence >= (options.confidenceThreshold ?? 0.7),
  );
  if (!best) {
    const rejectionReasonsByStrategy = candidates.map((candidate) => {
      const reasons: string[] = [];
      if (!candidate.unique)
        reasons.push(
          candidate.matchCount === 0
            ? "no semantic match"
            : "multiple semantic matches",
        );
      if (candidate.visibleCount !== 1)
        reasons.push("visible candidate count is not one");
      if (candidate.enabledCount !== 1)
        reasons.push("enabled candidate count is not one");
      if (options.requireEditable && candidate.editableCount !== 1)
        reasons.push("editable candidate count is not one");
      if (candidate.typeCompatibleCount !== 1)
        reasons.push("type-compatible candidate count is not one");
      if (!actionCompatible)
        reasons.push("recorded target is not compatible with this action");
      if (candidate.confidence < (options.confidenceThreshold ?? 0.7))
        reasons.push("confidence is below threshold");
      return {
        strategy: candidate.strategy,
        selectorPreview: candidate.selectorPreview,
        reasons,
      };
    });
    const maximum = (field: keyof LocatorCandidate) =>
      Math.max(
        0,
        ...candidates.map((candidate) => {
          const value = candidate[field];
          return typeof value === "number" ? value : 0;
        }),
      );
    const maximumForStrategies = (strategies: LocatorCandidate["strategy"][]) =>
      Math.max(
        0,
        ...candidates
          .filter((candidate) => strategies.includes(candidate.strategy))
          .map((candidate) => candidate.matchCount),
      );
    throw new LocatorValidationError({
      stepId: options.stepId ?? "unassigned-step",
      actionIndex: options.actionIndex ?? -1,
      recordedTargetFamily:
        options.target?.descriptor?.controlFamily ??
        (options.target ? inferredControlFamily(options.target) : "unknown"),
      normalizedActionableAncestorFamily:
        options.target?.descriptor?.controlFamily ??
        (options.target ? inferredControlFamily(options.target) : "unknown"),
      actionCompatibility:
        options.target?.descriptor?.actionCompatibility ??
        (options.action ? [options.action] : []),
      rawTargetPromoted: options.target?.descriptor?.rawTargetPromoted ?? false,
      accessibleNamePresent: Boolean(
        options.target?.descriptor?.accessibleName,
      ),
      normalizedStaticTextPresent: Boolean(
        options.target?.descriptor?.normalizedStaticText,
      ),
      semanticContainerMatchCount: maximumForStrategies([
        "container-role-name",
      ]),
      sameFormMatchCount: maximumForStrategies(["form-ownership"]),
      candidateCounts: {
        total: maximum("matchCount"),
        visible: maximum("visibleCount"),
        enabled: maximum("enabledCount"),
        editable: maximum("editableCount"),
        typeCompatible: maximum("typeCompatibleCount"),
      },
      rejectionReasonsByStrategy,
      originalDomNodeReplaced: options.originalDomNodeReplaced ?? false,
      semanticEquivalentFound: options.semanticEquivalentFound ?? false,
    });
  }
  return best;
}
