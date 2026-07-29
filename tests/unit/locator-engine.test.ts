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
      selectDemonstratedLocator(validated, {
        target: demonstratedTarget,
        action: "click",
      }).strategy,
    ).toBe("row-icon-context");
  });
});
