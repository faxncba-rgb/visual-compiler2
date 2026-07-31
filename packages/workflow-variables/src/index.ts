import { z } from "zod";
import type {
  DemonstrationSession,
  RuntimeValueTransform,
  StepExecutionGuard,
  WorkflowVariable,
} from "../../demonstration-ir/src";

export const LocalVariableValuesSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/),
  z.union([z.string(), z.number(), z.boolean()]),
);

export type LocalVariableValues = z.infer<typeof LocalVariableValuesSchema>;

export function resolveValueReference(
  valueRef: string | undefined,
  localLiteral: string | undefined,
  values: LocalVariableValues,
) {
  if (localLiteral !== undefined) return localLiteral;
  if (!valueRef) return undefined;
  const match = /^\{\{([a-z][a-z0-9_]*)\}\}$/.exec(valueRef);
  if (!match?.[1])
    throw new Error(`Invalid workflow value reference: ${valueRef}`);
  if (!(match[1] in values))
    throw new Error(`Missing local runtime variable: ${match[1]}`);
  return String(values[match[1]]);
}

export function valuesForAiInstruction(
  variables: WorkflowVariable[],
  values: LocalVariableValues,
) {
  return Object.fromEntries(
    variables
      .filter((variable) => variable.privacy === "ai-instruction")
      .flatMap((variable) =>
        variable.name in values
          ? [[variable.name, String(values[variable.name])]]
          : [],
      ),
  );
}

export function assertNoLocalValuesInSession(
  session: DemonstrationSession,
  values: LocalVariableValues,
) {
  const serialized = JSON.stringify(session);
  for (const value of Object.values(values)) {
    const text = String(value);
    // Very short option codes (for example "A") naturally occur throughout
    // structural metadata and cannot be meaningfully detected by substring
    // scanning. They are still parameterized; the contamination guard applies
    // to values long enough to identify reliably.
    if (text.length >= 8 && serialized.includes(text)) {
      throw new Error(
        "Demonstration IR contains a local runtime value that must remain separate.",
      );
    }
  }
}

export type RuntimeValueTransformAudit = {
  numericCandidates: number;
  excludedNumericCandidates: number;
  eligibleNumberFound: boolean;
};

function parseLocaleNumber(token: string) {
  const compact = token.replaceAll(/[\s\u00a0\u202f]/g, "");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  const normalized =
    decimalIndex < 0
      ? compact
      : `${compact.slice(0, decimalIndex).replaceAll(/[.,]/g, "")}.${compact.slice(decimalIndex + 1)}`;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function numberTokens(text: string) {
  return [
    ...text.matchAll(
      /(?<![\p{L}\p{N}])(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d+)?(?![\p{L}\p{N}])/gu,
    ),
  ].map((match) => match[0]);
}

export function applyRuntimeValueTransforms(
  input: string,
  transforms: RuntimeValueTransform[],
) {
  let value = input;
  const audit: RuntimeValueTransformAudit = {
    numericCandidates: 0,
    excludedNumericCandidates: 0,
    eligibleNumberFound: false,
  };
  for (const transform of transforms) {
    if (transform.type !== "number-in-range") continue;
    const candidates = numberTokens(value)
      .map((token) => ({ token, numeric: parseLocaleNumber(token) }))
      .filter(
        (
          candidate,
        ): candidate is {
          token: string;
          numeric: number;
        } => candidate.numeric !== undefined,
      );
    audit.numericCandidates += candidates.length;
    const eligible = candidates.find((candidate) => {
      const excluded = transform.excludedNumbers.some(
        (value) => Math.abs(value - candidate.numeric) < Number.EPSILON * 16,
      );
      if (excluded) audit.excludedNumericCandidates += 1;
      return (
        !excluded &&
        candidate.numeric >= transform.minimum &&
        candidate.numeric <= transform.maximum
      );
    });
    if (!eligible)
      throw new Error(
        "No eligible numeric value satisfied the deterministic extraction rule.",
      );
    audit.eligibleNumberFound = true;
    value = eligible.token.replaceAll(/[\s\u00a0\u202f]/g, "");
  }
  return { value, audit };
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function runtimeGuardMatches(
  guard: StepExecutionGuard,
  values: ReadonlyMap<string, string>,
) {
  const value = values.get(guard.variableName);
  if (value === undefined)
    throw new Error(
      `Missing ephemeral runtime variable: ${guard.variableName}`,
    );
  const flags = guard.caseSensitive ? "u" : "iu";
  const escaped = escapeRegularExpression(guard.keyword);
  const pattern = guard.wholeWord
    ? `(?:^|[^\\p{L}\\p{N}_])${escaped}(?:$|[^\\p{L}\\p{N}_])`
    : escaped;
  return new RegExp(pattern, flags).test(value);
}
