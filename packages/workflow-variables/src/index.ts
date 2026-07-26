import { z } from "zod";
import type {
  DemonstrationSession,
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
