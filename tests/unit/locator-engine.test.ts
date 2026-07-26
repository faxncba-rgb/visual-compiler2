import { describe, expect, it } from "vitest";
import {
  generateLocatorCandidates,
  rankLocatorCandidates,
  selectDemonstratedLocator,
  validateCapturedLocatorCandidates,
} from "../../packages/locator-engine/src";
import { candidate, target } from "../helpers/factories";

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
});
