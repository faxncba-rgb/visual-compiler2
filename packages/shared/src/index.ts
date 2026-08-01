import { createHash, randomUUID } from "node:crypto";

export const LAB_BANNER = "LAB MODE — synthetic test records only";

export function createId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalizeUrl(value: string) {
  const url = new URL(value);
  return {
    origin: url.origin,
    pathname: url.pathname || "/",
    canonicalUrl: `${url.origin}${url.pathname || "/"}`,
  };
}

export function redactUrl(value: string) {
  try {
    return canonicalizeUrl(value).canonicalUrl;
  } catch {
    return "[invalid-url]";
  }
}

export function isOpenAIUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "openai.com" ||
      hostname.endsWith(".openai.com") ||
      hostname === "api.openai.com"
    );
  } catch {
    return false;
  }
}

const sensitiveKey =
  /pass(word)?|secret|token|cookie|authorization|patient|(?:local|session|browser)[-_]?storage|api[-_]?key/i;

export function redactObject(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redactObject);
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).flatMap(([key, value]) => {
        if (sensitiveKey.test(key)) return [[key, "[REDACTED]"]];
        if (/url/i.test(key) && typeof value === "string")
          return [[key, redactUrl(value)]];
        return [[key, redactObject(value)]];
      }),
    );
  }
  return input;
}

export const StudioStates = [
  "IDLE",
  "BROWSER_OPEN",
  "AUTHENTICATING",
  "READY_TO_TEACH",
  "RECORDING",
  "DEMONSTRATION_REVIEW",
  "COMPILING",
  "COMPILED",
  "READY_TO_RUN",
  "RUNNING",
  "PASSED",
  "COMPLETED_UNVERIFIED",
  "FAILED",
  "STOPPED",
] as const;

export type StudioState = (typeof StudioStates)[number];

const transitions: Record<StudioState, readonly StudioState[]> = {
  IDLE: ["BROWSER_OPEN"],
  BROWSER_OPEN: ["AUTHENTICATING", "READY_TO_TEACH", "IDLE"],
  AUTHENTICATING: ["READY_TO_TEACH", "IDLE"],
  READY_TO_TEACH: ["RECORDING", "DEMONSTRATION_REVIEW", "READY_TO_RUN", "IDLE"],
  RECORDING: ["DEMONSTRATION_REVIEW", "STOPPED", "IDLE"],
  DEMONSTRATION_REVIEW: ["COMPILING", "RECORDING", "IDLE"],
  COMPILING: ["COMPILED", "DEMONSTRATION_REVIEW", "FAILED", "IDLE"],
  COMPILED: ["READY_TO_RUN", "RECORDING", "IDLE"],
  READY_TO_RUN: ["RUNNING", "RECORDING", "IDLE"],
  RUNNING: ["PASSED", "COMPLETED_UNVERIFIED", "FAILED", "STOPPED"],
  PASSED: ["RUNNING", "RECORDING", "IDLE"],
  COMPLETED_UNVERIFIED: ["RUNNING", "RECORDING", "IDLE"],
  FAILED: ["RUNNING", "RECORDING", "IDLE"],
  STOPPED: ["RUNNING", "RECORDING", "IDLE"],
};

export class StudioStateMachine {
  #state: StudioState = "IDLE";

  get state() {
    return this.#state;
  }

  can(next: StudioState) {
    return transitions[this.#state].includes(next);
  }

  transition(next: StudioState) {
    if (!this.can(next)) {
      throw new Error(`Invalid Studio transition: ${this.#state} → ${next}`);
    }
    this.#state = next;
    return this.#state;
  }

  compileReady() {
    this.transition("COMPILED");
    return this.transition("READY_TO_RUN");
  }

  reset() {
    this.#state = "IDLE";
  }
}

export function escapeForAttribute(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
