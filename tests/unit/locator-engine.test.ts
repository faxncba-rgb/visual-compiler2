import { describe, expect, it } from "vitest";
import {
  generateLocatorCandidates,
  LocatorValidationError,
  rankLocatorCandidates,
  selectDemonstratedLocator,
  validateCapturedLocatorCandidates,
} from "../../packages/locator-engine/src";
import { candidate, target } from "../helpers/factories";

function saveTarget() {
  const value = target();
  value.tag = "a";
  value.role = "link";
  value.accessibleName = "Enregistrer";
  delete value.associatedLabel;
  value.editable = false;
  value.formName = "consultation-record";
  value.stableAttributes = {
    "data-vc-action": "save-consultation",
  };
  value.descriptor = {
    ...value.descriptor!,
    controlFamily: "link",
    multiline: false,
    editable: false,
    actionCompatibility: ["click"],
    tag: "a",
    role: "link",
    accessibleName: "Enregistrer",
    normalizedStaticText: "Enregistrer",
    hasOnclick: true,
    rawTargetPromoted: true,
    formName: "consultation-record",
  };
  delete value.descriptor.associatedLabel;
  return value;
}

function anonymousIconTarget() {
  const value = target();
  value.tag = "a";
  value.role = "link";
  delete value.accessibleName;
  delete value.associatedLabel;
  value.editable = false;
  const descriptor: NonNullable<typeof value.descriptor> = {
    ...value.descriptor!,
    controlFamily: "link",
    multiline: false,
    editable: false,
    actionCompatibility: ["click"],
    tag: "a",
    role: "link",
    hasOnclick: false,
    rawTargetPromoted: true,
  };
  delete descriptor.accessibleName;
  delete descriptor.associatedLabel;
  value.descriptor = descriptor;
  value.clickEvidence = {
    rawTarget: {
      tag: "i",
      structuralPath:
        "html > body > table > tbody > tr:nth-of-type(3) > td:nth-of-type(11) > a > i",
    },
    normalizedClickable: {
      tag: "a",
      role: "link",
      structuralPath:
        "html > body > table > tbody > tr:nth-of-type(3) > td:nth-of-type(11) > a",
    },
    icon: { tag: "i" },
    canonicalHref: "https://synthetic.invalid/saisie/codage_etage.cgi",
    table: {
      rowIndex: 3,
      columnIndex: 10,
      headers: Array.from({ length: 12 }, (_, index) => `Colonne ${index + 1}`),
      rowText: ["Repère 3-1", "Repère 3-2", "Repère 3-3"],
    },
    domRelations: ["raw-descendant-of-normalized", "a>a"],
    structuralSnapshot: [
      "html > body > table > tbody > tr:nth-of-type(3) > td:nth-of-type(11) > a > i",
      "html > body > table > tbody > tr:nth-of-type(3) > td:nth-of-type(11) > a",
    ],
    captureValidation: {
      canonicalHrefMatchCount: 8,
      iconMatchCount: 0,
      rowIconMatchCount: 0,
    },
  };
  return value;
}

function anonymousDescendantTarget() {
  const value = anonymousIconTarget();
  value.clickEvidence = {
    ...value.clickEvidence!,
    rawTarget: {
      tag: "em",
      structuralPath:
        "html > body > table > tbody > tr:nth-of-type(2) > td:nth-of-type(13) > a > em",
    },
    normalizedClickable: {
      tag: "a",
      role: "link",
      structuralPath:
        "html > body > table > tbody > tr:nth-of-type(2) > td:nth-of-type(13) > a",
    },
    icon: undefined,
    canonicalHref: "https://synthetic.invalid/saisie/anesthesie.cgi",
    table: {
      rowIndex: 2,
      columnIndex: 12,
      headers: Array.from({ length: 13 }, (_, index) => `Colonne ${index + 1}`),
      rowText: ["Repère cible", "Salle synthétique", "Statut témoin"],
    },
    structuralSnapshot: [
      "html > body > table > tbody > tr:nth-of-type(2) > td:nth-of-type(13) > a > em",
      "html > body > table > tbody > tr:nth-of-type(2) > td:nth-of-type(13) > a",
    ],
    captureValidation: {
      canonicalHrefMatchCount: 2,
      iconMatchCount: 0,
      rowIconMatchCount: 0,
      rowClickableMatchCount: 1,
    },
  };
  return value;
}

function anonymousPopupExtractionTarget() {
  const value = target();
  value.tag = "span";
  value.role = undefined;
  value.accessibleName = undefined;
  value.associatedLabel = undefined;
  value.editable = false;
  value.semanticContainer = undefined;
  value.structuralPath =
    "tbody:nth-of-type(2) > tr > td > div:nth-of-type(1) > div:nth-of-type(3) > div:nth-of-type(8) > span:nth-of-type(1)";
  value.stableAttributes = {};
  value.descriptor = {
    ...value.descriptor!,
    controlFamily: "other",
    multiline: false,
    editable: false,
    actionCompatibility: ["extract"],
    tag: "span",
    role: undefined,
    accessibleName: undefined,
    associatedLabel: undefined,
    normalizedStaticText: undefined,
    hasOnclick: false,
    rawTargetPromoted: false,
  };
  value.captureValidation = {
    exactTargetConnected: true,
    roleNameMatchCount: 0,
    labelMatchCount: 0,
    stableAttributeMatchCount: 0,
  };
  return value;
}

describe("demonstration-first locator engine", () => {
  it("preserves the exact consultation editor instead of choosing the first textbox", () => {
    const candidates = generateLocatorCandidates(target());
    expect(candidates[0]).toMatchObject({
      strategy: "role-name",
      rule: { role: "textbox", name: "Texte de consultation" },
      demonstratedFingerprint: "fnv1a-deadbeef",
    });
    expect(
      candidates.every(
        (entry) => entry.selectorPreview !== 'getByRole("textbox")',
      ),
    ).toBe(true);
  });

  it("preserves a dynamic form-control family and its demonstrated ordinal", () => {
    const demonstratedTarget = target();
    demonstratedTarget.tag = "input";
    demonstratedTarget.stableAttributes = { name: "dho_1503004" };
    demonstratedTarget.dynamicFormControlIdentity = {
      namePrefix: "dho_",
      ordinal: 0,
    };
    const candidates = generateLocatorCandidates(demonstratedTarget);
    const dynamicCandidate = candidates.find(
      (candidate) => candidate.strategy === "form-control-prefix-ordinal",
    );
    expect(dynamicCandidate).toMatchObject({
      strategy: "form-control-prefix-ordinal",
      rule: {
        strategy: "form-control-prefix-ordinal",
        formControlNamePrefix: "dho_",
        ordinal: 0,
        tagName: "input",
      },
    });
    expect(dynamicCandidate?.selectorPreview).toBe(
      'input[name^="dho_"].nth(0)',
    );
  });

  it("ranks semantic uniqueness above generic or coordinate fallbacks", () => {
    const exact = candidate();
    const coordinate = candidate({
      id: "coordinate",
      strategy: "absolute-coordinate",
      rule: { strategy: "absolute-coordinate" },
      confidence: 0.99,
      stability: 0.01,
    });
    expect(rankLocatorCandidates([coordinate, exact])[0]?.id).toBe("locator-1");
  });

  it("rejects readonly decoys for fill actions", () => {
    expect(() =>
      selectDemonstratedLocator([candidate({ editableCount: 0 })], {
        requireEditable: true,
      }),
    ).toThrow("no unique");
  });

  it("uses capture-time validation for an auto-closed popup", () => {
    const validated = validateCapturedLocatorCandidates(target());
    const selected = selectDemonstratedLocator(validated, {
      requireEditable: true,
    });
    expect(selected.matchCount).toBe(1);
    expect(selected.explanation).toContain("transient context had closed");
  });

  it("retains an exact structural locator for an anonymous popup extraction zone", () => {
    const extractionTarget = anonymousPopupExtractionTarget();
    const candidates = generateLocatorCandidates(extractionTarget);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      strategy: "structural-fallback",
      rule: {
        strategy: "structural-fallback",
        structuralPath: extractionTarget.structuralPath,
      },
      confidence: 0.9,
    });
    const selected = selectDemonstratedLocator(
      validateCapturedLocatorCandidates(extractionTarget, candidates),
      {
        target: extractionTarget,
        action: "extract",
      },
    );
    expect(selected.unique).toBe(true);
    expect(selected.visibleCount).toBe(1);
    expect(selected.enabledCount).toBe(1);
    expect(selected.typeCompatibleCount).toBe(1);
  });

  it("reports redacted structural rejection evidence", () => {
    try {
      selectDemonstratedLocator(
        [
          candidate({
            matchCount: 2,
            visibleCount: 2,
            enabledCount: 2,
            editableCount: 2,
            typeCompatibleCount: 2,
            unique: false,
          }),
        ],
        {
          requireEditable: true,
          target: target(),
          action: "fill",
          originalDomNodeReplaced: true,
          semanticEquivalentFound: true,
        },
      );
      throw new Error("Expected locator validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(LocatorValidationError);
      expect((error as LocatorValidationError).evidence).toMatchObject({
        recordedTargetFamily: "multiline-text",
        actionCompatibility: ["fill"],
        candidateCounts: {
          total: 2,
          visible: 2,
          enabled: 2,
          editable: 2,
          typeCompatible: 2,
        },
        originalDomNodeReplaced: true,
        semanticEquivalentFound: true,
      });
    }
  });

  it("generates named, exact-text and sequence-aware form locators instead of a generic link", () => {
    const candidates = generateLocatorCandidates(saveTarget(), {
      previousActionId: "action-fill",
      previousAction: "fill",
      demonstratedAfterPrevious: true,
      sameForm: true,
      sameSemanticContainer: true,
      savesPreviousEditor: true,
    });
    expect(candidates[0]?.rule).toMatchObject({
      strategy: "role-name",
      role: "link",
      name: "Enregistrer",
    });
    expect(candidates[1]?.rule).toMatchObject({
      strategy: "text-dom-relation",
      tagName: "a",
      staticText: "Enregistrer",
    });
    expect(
      candidates.find((entry) => entry.strategy === "form-ownership")?.rule,
    ).toMatchObject({
      formName: "consultation-record",
      controlFamily: "link",
      staticText: "Enregistrer",
      sequencePreviousActionId: "action-fill",
    });
    expect(
      candidates.some(
        (entry) =>
          entry.selectorPreview === "a" ||
          entry.selectorPreview === "getByRole(link)",
      ),
    ).toBe(false);
  });

  it("ranks exact semantics before demonstrated form and shared-container fallbacks", () => {
    const validated = generateLocatorCandidates(saveTarget(), {
      previousActionId: "action-fill",
      previousAction: "fill",
      demonstratedAfterPrevious: true,
      sameForm: true,
      sameSemanticContainer: true,
      savesPreviousEditor: true,
    })
      .filter((entry) =>
        [
          "role-name",
          "text-dom-relation",
          "form-ownership",
          "container-role-name",
        ].includes(entry.strategy),
      )
      .map((entry) => ({
        ...entry,
        matchCount: 1,
        visibleCount: 1,
        enabledCount: 1,
        typeCompatibleCount: 1,
        unique: true,
      }));
    expect(
      rankLocatorCandidates(validated).map((entry) => entry.strategy),
    ).toEqual([
      "role-name",
      "text-dom-relation",
      "form-ownership",
      "container-role-name",
    ]);
  });

  it("selects the unique demonstrated-form Enregistrer among unrelated and global links", () => {
    const selected = selectDemonstratedLocator(
      [
        candidate({
          id: "global-role",
          strategy: "role-name",
          rule: {
            strategy: "role-name",
            role: "link",
            name: "Enregistrer",
          },
          matchCount: 2,
          visibleCount: 2,
          enabledCount: 2,
          typeCompatibleCount: 2,
          unique: false,
        }),
        candidate({
          id: "global-text",
          strategy: "text-dom-relation",
          rule: {
            strategy: "text-dom-relation",
            tagName: "a",
            staticText: "Enregistrer",
          },
          matchCount: 2,
          visibleCount: 2,
          enabledCount: 2,
          typeCompatibleCount: 2,
          unique: false,
        }),
        candidate({
          id: "same-form",
          strategy: "form-ownership",
          rule: {
            strategy: "form-ownership",
            formName: "consultation-record",
            controlFamily: "link",
            staticText: "Enregistrer",
          },
          editableCount: 0,
        }),
      ],
      { target: saveTarget(), action: "click" },
    );
    expect(selected.id).toBe("same-form");
  });

  it("fails closed when Enregistrer remains ambiguous inside the demonstrated form", () => {
    expect(() =>
      selectDemonstratedLocator(
        [
          candidate({
            strategy: "role-name",
            matchCount: 2,
            visibleCount: 2,
            enabledCount: 2,
            typeCompatibleCount: 2,
            unique: false,
          }),
          candidate({
            strategy: "text-dom-relation",
            matchCount: 2,
            visibleCount: 2,
            enabledCount: 2,
            typeCompatibleCount: 2,
            unique: false,
          }),
          candidate({
            strategy: "form-ownership",
            matchCount: 2,
            visibleCount: 2,
            enabledCount: 2,
            typeCompatibleCount: 2,
            unique: false,
          }),
        ],
        { target: saveTarget(), action: "click" },
      ),
    ).toThrow("no unique");
  });

  it("uses row and column evidence for an anonymous <i> among eight canonical href matches", () => {
    const demonstratedTarget = anonymousIconTarget();
    const candidates = generateLocatorCandidates(demonstratedTarget);
    const canonical = candidates.find(
      (entry) => entry.strategy === "canonical-href",
    );
    const rowContext = candidates.find(
      (entry) => entry.strategy === "row-icon-context",
    );
    const coordinateFallback = candidates.find(
      (entry) => entry.strategy === "same-row-column",
    );

    expect(rowContext).toMatchObject({
      rule: {
        strategy: "row-icon-context",
        rowIndex: 3,
        columnIndex: 10,
        iconTag: "i",
        canonicalHref: "https://synthetic.invalid/saisie/codage_etage.cgi",
      },
      selectorPreview: "row(<captured-structure>).cell(10).clickable-icon",
    });
    expect(rowContext?.selectorPreview).not.toContain("Repère");
    expect(coordinateFallback).toMatchObject({
      rule: {
        strategy: "same-row-column",
        rowIndex: 3,
        columnIndex: 10,
        canonicalHref: "https://synthetic.invalid/saisie/codage_etage.cgi",
      },
      selectorPreview: "table.row(3).cell(10).clickable-icon",
    });
    expect(coordinateFallback?.rule.rowTexts).toBeUndefined();
    expect(coordinateFallback?.rule.iconTag).toBeUndefined();

    const validated = validateCapturedLocatorCandidates(
      demonstratedTarget,
      candidates,
    );
    expect(validated.find((entry) => entry.id === canonical?.id)).toMatchObject(
      {
        matchCount: 8,
        unique: false,
      },
    );
    expect(
      validated.find((entry) => entry.id === rowContext?.id),
    ).toMatchObject({
      matchCount: 1,
      visibleCount: 1,
      enabledCount: 1,
      typeCompatibleCount: 1,
      unique: true,
    });
    expect(
      validated.find((entry) => entry.id === coordinateFallback?.id),
    ).toMatchObject({
      matchCount: 1,
      visibleCount: 1,
      enabledCount: 1,
      typeCompatibleCount: 1,
      unique: true,
    });
    expect(
      selectDemonstratedLocator(validated, {
        target: demonstratedTarget,
        action: "click",
      }).strategy,
    ).toBe("row-icon-context");
  });

  it("retains a unique icon independently of a patient-specific link href", () => {
    const demonstratedTarget = anonymousIconTarget();
    demonstratedTarget.clickEvidence = {
      ...demonstratedTarget.clickEvidence!,
      icon: {
        tag: "img",
        title: "Modifier/Ajouter un modificateur",
        src: "https://synthetic.invalid/images/modifier.gif",
      },
      captureValidation: {
        ...demonstratedTarget.clickEvidence!.captureValidation,
        iconMatchCount: 1,
      },
    };
    const candidate = generateLocatorCandidates(demonstratedTarget).find(
      (entry) =>
        entry.strategy === "icon-evidence" &&
        entry.rule.canonicalHref === undefined,
    );
    expect(candidate).toMatchObject({
      strategy: "icon-evidence",
      selectorPreview: "clickable:has(unique-captured-icon)",
      rule: {
        iconTitle: "Modifier/Ajouter un modificateur",
        iconSrc: "https://synthetic.invalid/images/modifier.gif",
      },
    });
  });

  it("promotes an anonymous <em> descendant and resolves the unique row clickable among duplicate hrefs", () => {
    const demonstratedTarget = anonymousDescendantTarget();
    const candidates = generateLocatorCandidates(demonstratedTarget);
    const canonical = candidates.find(
      (entry) => entry.strategy === "canonical-href",
    );
    const rowContext = candidates.find(
      (entry) => entry.strategy === "row-clickable-context",
    );
    const coordinateFallback = candidates.find(
      (entry) => entry.strategy === "same-row-column",
    );

    expect(rowContext).toMatchObject({
      rule: {
        strategy: "row-clickable-context",
        rowIndex: 2,
        columnIndex: 12,
        canonicalHref: "https://synthetic.invalid/saisie/anesthesie.cgi",
      },
      selectorPreview: "row(<captured-structure>).cell(12).clickable",
    });
    expect(coordinateFallback).toMatchObject({
      rule: {
        strategy: "same-row-column",
        rowIndex: 2,
        columnIndex: 12,
        canonicalHref: "https://synthetic.invalid/saisie/anesthesie.cgi",
      },
      selectorPreview: "table.row(2).cell(12).clickable",
    });

    const validated = validateCapturedLocatorCandidates(
      demonstratedTarget,
      candidates,
    );
    expect(validated.find((entry) => entry.id === canonical?.id)).toMatchObject(
      {
        matchCount: 2,
        unique: false,
      },
    );
    expect(
      validated.find((entry) => entry.id === rowContext?.id),
    ).toMatchObject({
      matchCount: 1,
      visibleCount: 1,
      enabledCount: 1,
      typeCompatibleCount: 1,
      unique: true,
    });
    expect(
      selectDemonstratedLocator(validated, {
        target: demonstratedTarget,
        action: "click",
      }).strategy,
    ).toBe("row-clickable-context");
  });
});
