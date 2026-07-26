import {
  RuntimeTelemetrySchema,
  type RuntimeTelemetry,
} from "../../demonstration-ir/src";
import { createId } from "../../shared/src";

export function createRuntimeTelemetry(
  workflowId: string,
  mode: "local" | "animated",
): RuntimeTelemetry {
  return RuntimeTelemetrySchema.parse({
    workflowId,
    runId: createId("run"),
    mode,
    state: "Ready",
    startedAt: new Date().toISOString(),
    llmCalls: 0,
    openAIRequests: 0,
    steps: [],
    outcomeChecks: [],
    redactedLog: [],
  });
}

export function safeTelemetryMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(/https?:\/\/[^\s"']+/g, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return "[redacted-url]";
      }
    })
    .replaceAll(
      /(password|token|secret|patient)[=:]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    );
}
