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
    extractionAudit: [],
    redactedLog: [],
  });
}

export function safeTelemetryMessage(
  error: unknown,
  sensitiveValues: Iterable<string> = [],
) {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of sensitiveValues) {
    if (value) message = message.replaceAll(value, "[REDACTED_FORM_VALUE]");
  }
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
      /\b(Bearer|Basic)\s+[a-z0-9._~+/=-]+/gi,
      "[REDACTED_AUTHORIZATION]",
    )
    .replaceAll(/([?&][^=\s&#]+)=([^&#\s]+)/g, "$1=[REDACTED]")
    .replaceAll(
      /(password|passcode|token|secret|patient|cookie|authorization|authentication|api[-_]?key|form[-_]?value|query|parameter)[=:]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    );
}
