import type {
  BrowserContext,
  Dialog,
  Frame,
  Locator,
  Page,
  Route,
} from "playwright";
import {
  attachImplicitPopupOpeners,
  CompiledWorkflowSchema,
  RuntimeTelemetrySchema,
  type CompiledLoop,
  type CompiledPageContext,
  type CompiledStep,
  type CompiledWorkflow,
  type LocatorCandidate,
  type LocatorRule,
  type RuntimeTelemetry,
} from "../../demonstration-ir/src";
import {
  locatorForRule,
  rankLocatorCandidates,
  type LocatorRoot,
} from "../../locator-engine/src";
import {
  createRuntimeTelemetry,
  safeTelemetryMessage,
} from "../../telemetry/src";
import {
  applyRuntimeValueTransforms,
  LocalVariableValuesSchema,
  resolveValueReference,
  runtimeGuardMatches,
  type LocalVariableValues,
} from "../../workflow-variables/src";
import {
  canonicalizeUrl,
  escapeForAttribute,
  isOpenAIUrl,
  sha256,
} from "../../shared/src";

export type RuntimeAnimation = {
  beforeStep?: (details: {
    step: CompiledStep;
    locator?: Locator;
    phase:
      | "Resolving target"
      | "Highlighting target"
      | "Executing action"
      | "Verifying action"
      | "Waiting for popup"
      | "Verifying outcome";
  }) => Promise<void>;
  afterStep?: (details: {
    step: CompiledStep;
    locator?: Locator;
  }) => Promise<void>;
};

export type RuntimeOptions = {
  context: BrowserContext;
  workflow: CompiledWorkflow;
  variables: LocalVariableValues;
  mode: "local" | "animated";
  signal?: AbortSignal;
  animation?: RuntimeAnimation;
  stepTimeoutMs?: number;
};

export type BoundedLoopAdapter<T> = {
  first(): Promise<T | undefined>;
  next(current: T): Promise<T | undefined>;
  fingerprint(item: T): Promise<string>;
  eligible(item: T): Promise<boolean>;
  run(item: T, iteration: number): Promise<void>;
};

export async function executeBoundedLoop<T>(
  loop: CompiledLoop,
  adapter: BoundedLoopAdapter<T>,
  signal?: AbortSignal,
) {
  const startedAt = Date.now();
  const fingerprints = new Set<string>();
  const results: Array<{
    iteration: number;
    fingerprint: string;
    status: "passed" | "skipped";
  }> = [];
  let item = await adapter.first();
  let iteration = 0;
  while (item !== undefined) {
    if (signal?.aborted)
      throw new DOMException("Runtime stopped.", "AbortError");
    if (iteration >= loop.maximumIterations) break;
    if (Date.now() - startedAt >= loop.maximumDurationMs) break;
    const fingerprint = await adapter.fingerprint(item);
    if (loop.duplicateItemProtection && fingerprints.has(fingerprint)) break;
    fingerprints.add(fingerprint);
    if (await adapter.eligible(item)) {
      await adapter.run(item, iteration);
      results.push({ iteration, fingerprint, status: "passed" });
    } else {
      results.push({ iteration, fingerprint, status: "skipped" });
    }
    iteration += 1;
    item = await adapter.next(item);
  }
  return {
    iterations: iteration,
    elapsedMs: Date.now() - startedAt,
    duplicateProtected: fingerprints.size === iteration,
    results,
  };
}

function canonicalMatches(pageUrl: string, context: CompiledPageContext) {
  try {
    const canonical = canonicalizeUrl(pageUrl);
    return (
      canonical.origin === context.origin &&
      canonical.pathname === context.pathname
    );
  } catch {
    return false;
  }
}

function normalizeContinuationPrompt(value: string) {
  return value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function isPermittedContinuationPrompt(value: string) {
  return normalizeContinuationPrompt(value).includes("voulez vous continuer");
}

async function isTopDocumentInspectable(frame: Frame) {
  return frame
    .evaluate(() => {
      try {
        return Boolean(globalThis.top?.document);
      } catch {
        return false;
      }
    })
    .catch(() => false);
}

function runtimeTitlePattern(value: string) {
  return value
    .replaceAll(/\d+/g, "\\d+")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function selectedFirst(step: CompiledStep) {
  const ranked = rankLocatorCandidates(step.locatorCandidates);
  const selected = ranked.find(
    (candidate) => candidate.id === step.selectedLocatorId,
  );
  return selected
    ? [selected, ...ranked.filter((candidate) => candidate.id !== selected.id)]
    : ranked;
}

function runtimeLocatorAttempts(step: CompiledStep) {
  const ranked = selectedFirst(step);
  const hasExplicitCoordinateFallback = ranked.some(
    (candidate) => candidate.strategy === "same-row-column",
  );
  const attempts: Array<{
    candidate: LocatorCandidate;
    rule: LocatorRule;
  }> = [];
  for (const candidate of ranked) {
    attempts.push({ candidate, rule: candidate.rule });
    const rule = candidate.rule;
    const iconEvidenceEntries: Array<
      ["iconAlt" | "iconTitle" | "iconSrc", string | undefined]
    > = [
      ["iconAlt", rule.iconAlt],
      ["iconTitle", rule.iconTitle],
      ["iconSrc", rule.iconSrc],
    ];
    const namedIconEvidence = iconEvidenceEntries.filter(
      (entry): entry is ["iconAlt" | "iconTitle" | "iconSrc", string] =>
        Boolean(entry[1]),
    );
    if (namedIconEvidence.length > 1) {
      for (const [retainedKey] of namedIconEvidence) {
        attempts.push({
          candidate,
          rule: {
            ...rule,
            iconAlt: retainedKey === "iconAlt" ? rule.iconAlt : undefined,
            iconTitle: retainedKey === "iconTitle" ? rule.iconTitle : undefined,
            iconSrc: retainedKey === "iconSrc" ? rule.iconSrc : undefined,
          },
        });
      }
    }
    const anonymousStructuralIcon =
      rule.strategy === "row-icon-context" &&
      Boolean(rule.iconTag) &&
      !rule.iconAlt &&
      !rule.iconTitle &&
      !rule.iconSrc;
    const rowWithoutIconIdentity =
      (rule.strategy === "row-icon-context" ||
        rule.strategy === "same-row-column") &&
      namedIconEvidence.length > 0
        ? {
            ...rule,
            iconAlt: undefined,
            iconTitle: undefined,
            iconSrc: undefined,
            iconTag: undefined,
          }
        : undefined;
    const rowTexts =
      rule.strategy === "row-icon-context" ||
      rule.strategy === "row-clickable-context"
        ? (rule.rowTexts ?? (rule.rowText ? [rule.rowText] : []))
        : [];
    if (anonymousStructuralIcon) {
      attempts.push({
        candidate,
        rule: {
          ...rule,
          iconTag: undefined,
        },
      });
    }
    if (rowWithoutIconIdentity) {
      attempts.push({ candidate, rule: rowWithoutIconIdentity });
    }
    if (rowTexts.length > 1) {
      for (
        let omittedIndex = 0;
        omittedIndex < rowTexts.length;
        omittedIndex += 1
      ) {
        const retainedRowTexts = rowTexts.filter(
          (_, index) => index !== omittedIndex,
        );
        attempts.push({
          candidate,
          rule: {
            ...rule,
            rowText: retainedRowTexts[0],
            rowTexts: retainedRowTexts,
          },
        });
        if (anonymousStructuralIcon) {
          attempts.push({
            candidate,
            rule: {
              ...rule,
              rowText: retainedRowTexts[0],
              rowTexts: retainedRowTexts,
              iconTag: undefined,
            },
          });
        }
        if (rowWithoutIconIdentity) {
          attempts.push({
            candidate,
            rule: {
              ...rowWithoutIconIdentity,
              rowText: retainedRowTexts[0],
              rowTexts: retainedRowTexts,
            },
          });
        }
      }
    }
    if (
      !hasExplicitCoordinateFallback &&
      (rule.strategy === "row-icon-context" ||
        rule.strategy === "row-clickable-context") &&
      rule.rowIndex !== undefined &&
      rule.columnIndex !== undefined
    ) {
      attempts.push({
        candidate,
        rule: {
          ...rule,
          strategy: "same-row-column",
          rowText: undefined,
          rowTexts: undefined,
          ...(anonymousStructuralIcon ? { iconTag: undefined } : {}),
        },
      });
    }
  }
  return attempts;
}

function abortError() {
  return new DOMException("Runtime stopped by user.", "AbortError");
}

function throwIfStopped(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function waitForAbortableTimeout(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createAnimatedPresentation(delayMs = 450): RuntimeAnimation {
  return {
    async beforeStep({ locator, phase }) {
      if (phase === "Highlighting target" && locator) {
        await locator
          .evaluate((element) => {
            const html = element as HTMLElement;
            html.dataset.vc2PreviousOutline = html.style.outline;
            html.style.outline = "4px solid #f2c94c";
            html.style.outlineOffset = "4px";
            html.scrollIntoView({ block: "center", behavior: "smooth" });
          })
          .catch(() => undefined);
        await waitForAbortableTimeout(delayMs);
      }
    },
    async afterStep({ locator }) {
      if (!locator) return;
      await locator
        .evaluate((element) => {
          const html = element as HTMLElement;
          html.style.outline = html.dataset.vc2PreviousOutline ?? "";
          html.style.outlineOffset = "";
          delete html.dataset.vc2PreviousOutline;
        })
        .catch(() => undefined);
    },
  };
}

type RunPages = {
  resolved: Map<string, Page | Frame>;
  runtimePopups: Map<string, Page>;
  closedContexts: Set<string>;
};

export class DeterministicRuntime {
  readonly #workflow: CompiledWorkflow;
  readonly #variables: LocalVariableValues;
  readonly #timeout: number;
  readonly #pages: RunPages = {
    resolved: new Map(),
    runtimePopups: new Map(),
    closedContexts: new Set(),
  };
  #blockedOpenAIAttempts = 0;
  #activeDialog:
    | { type: string; response: "accepted" | "dismissed" }
    | undefined;
  #dialogCursor = 0;
  #continuationConfirmationCount = 0;
  #continuationResumePending = false;
  #continuationDialogFailure: Error | undefined;
  readonly #permittedContinuationPages = new Set<Page>();
  readonly #continuationSkippedPopupContexts = new Set<string>();
  readonly #ephemeralValues = new Map<string, string>();
  readonly #outcomeBaselines = new Map<string, string | number>();
  readonly #extractionAudit: RuntimeTelemetry["extractionAudit"] = [];
  #loopIteration = 0;
  #loopAnchorOrdinal = 0;
  #routeInstalled = false;
  #networkHandler: ((route: Route) => Promise<void>) | undefined;
  #dialogHandler: ((dialog: Dialog) => Promise<void>) | undefined;
  #pageDialogListener: ((page: Page) => void) | undefined;

  constructor(private readonly options: RuntimeOptions) {
    this.#workflow = CompiledWorkflowSchema.parse(options.workflow);
    attachImplicitPopupOpeners(
      this.#workflow.steps,
      this.#workflow.pageContexts,
    );
    this.#variables = LocalVariableValuesSchema.parse(options.variables);
    this.#timeout = options.stepTimeoutMs ?? 10_000;
  }

  async run(): Promise<RuntimeTelemetry> {
    const telemetry = createRuntimeTelemetry(
      this.#workflow.id,
      this.options.mode,
    );
    telemetry.state = "Running";
    const loop = this.#workflow.loops[0];
    const requestedIterations = loop?.maximumIterations ?? 1;
    const loopStartedAt = Date.now();
    const loopFingerprints = new Set<string>();
    let completedIterations = 0;
    let duplicateProtectionTriggered = false;
    this.#installDialogHandler();
    await this.#installNetworkGuard();
    try {
      for (
        this.#loopIteration = 0;
        this.#loopIteration < requestedIterations;
        this.#loopIteration += 1
      ) {
        throwIfStopped(this.options.signal);
        if (loop && Date.now() - loopStartedAt >= loop.maximumDurationMs)
          throw new Error(
            "Bounded workflow duration elapsed before all requested iterations completed.",
          );
        this.#resetIterationState();
        await this.#resolveInitialContexts();
        if (loop?.duplicateItemProtection) {
          const fingerprint = await this.#currentLoopItemFingerprint(
            loop,
            loopFingerprints,
          );
          if (!fingerprint) {
            telemetry.redactedLog.push(
              `Completed all ${completedIterations} available unique records before the configured maximum of ${requestedIterations}.`,
            );
            break;
          }
          if (loopFingerprints.has(fingerprint)) {
            duplicateProtectionTriggered = true;
            throw new Error(
              "Duplicate item protection stopped the workflow before replaying the same record.",
            );
          }
          loopFingerprints.add(fingerprint);
        }
        await this.#captureOutcomeBaselines();
        let continuationResumeStepId: string | undefined;
        for (const [stepIndex, step] of this.#workflow.steps.entries()) {
          throwIfStopped(this.options.signal);
          const started = Date.now();
          const iterationLabel =
            requestedIterations > 1
              ? `Iteration ${this.#loopIteration + 1}/${requestedIterations}: `
              : "";
          if (
            continuationResumeStepId &&
            step.id !== continuationResumeStepId
          ) {
            telemetry.steps.push({
              stepId: step.id,
              pageContextId: step.pageContextId,
              action: step.action,
              status: "skipped",
              durationMs: Date.now() - started,
              message: `${iterationLabel}Skipped a transient popup branch after the permitted continuation confirmation.`,
            });
            continue;
          }
          if (step.id === continuationResumeStepId)
            continuationResumeStepId = undefined;
          if (step.executionGuard) {
            const matched = runtimeGuardMatches(
              step.executionGuard,
              this.#ephemeralValues,
            );
            this.#recordKeywordAudit(
              step.executionGuard.variableName,
              step.executionGuard.keyword,
              matched,
            );
            if (!matched) {
              telemetry.steps.push({
                stepId: step.id,
                pageContextId: step.pageContextId,
                action: step.action,
                status: "skipped",
                durationMs: Date.now() - started,
                message: `${iterationLabel}Skipped because the deterministic keyword condition was false.`,
              });
              continue;
            }
          }
          if (this.#isRedundantLegacySelectionClick(step, stepIndex)) {
            telemetry.steps.push({
              stepId: step.id,
              pageContextId: step.pageContextId,
              action: step.action,
              status: "skipped",
              durationMs: Date.now() - started,
              message: `${iterationLabel}Skipped a redundant legacy click surrounding the demonstrated select action.`,
            });
            continue;
          }
          if (this.#isRedundantSubmit(step, stepIndex)) {
            telemetry.steps.push({
              stepId: step.id,
              pageContextId: step.pageContextId,
              action: step.action,
              status: "skipped",
              durationMs: Date.now() - started,
              message: `${iterationLabel}Skipped the duplicate submit event emitted by the already executed submit control click.`,
            });
            continue;
          }
          try {
            const result = await this.#runStep(step);
            telemetry.steps.push({
              stepId: step.id,
              pageContextId: step.pageContextId,
              action: step.action,
              status: result.skipped ? "skipped" : "passed",
              durationMs: Date.now() - started,
              ...(result.candidate
                ? { locatorStrategy: result.candidate.strategy }
                : {}),
              message: `${iterationLabel}${result.message}`,
            });
          } catch (error) {
            const continuationResumeStep =
              await this.#resolveConfiguredContinuationResume(
                step,
                stepIndex,
                error,
              );
            if (continuationResumeStep) {
              telemetry.steps.push({
                stepId: step.id,
                pageContextId: step.pageContextId,
                action: step.action,
                status: "skipped",
                durationMs: Date.now() - started,
                message: `${iterationLabel}Skipped an unavailable transient popup opener after resolving the configured continuation target.`,
              });
              continuationResumeStepId = continuationResumeStep.id;
              continue;
            }
            if (step.optional) {
              telemetry.steps.push({
                stepId: step.id,
                pageContextId: step.pageContextId,
                action: step.action,
                status: "skipped",
                durationMs: Date.now() - started,
                message: `${iterationLabel}${safeTelemetryMessage(error)}`,
              });
              continue;
            }
            throw Object.assign(
              error instanceof Error ? error : new Error(String(error)),
              {
                step,
              },
            );
          }
        }
        throwIfStopped(this.options.signal);
        await this.options.animation?.beforeStep?.({
          step: this.#workflow.steps.at(-1)!,
          phase: "Verifying outcome",
        });
        telemetry.outcomeChecks = await this.#verifyOutcome();
        completedIterations += 1;
        if (requestedIterations > 1)
          telemetry.redactedLog.push(
            `Completed bounded local iteration ${completedIterations} of ${requestedIterations}.`,
          );
      }
      if (this.#blockedOpenAIAttempts > 0) {
        throw new Error(
          "Runtime blocked an attempted OpenAI request; execution failed closed.",
        );
      }
      if (this.#workflow.expectedOutcome.verification === "VERIFIED") {
        telemetry.state = "Passed";
        telemetry.redactedLog.push(
          "Application-level positive outcome verified.",
        );
      } else {
        telemetry.state = "CompletedUnverified";
        telemetry.redactedLog.push(
          "Actions completed without verified positive application evidence.",
        );
      }
      telemetry.redactedLog.push(
        "Runtime LLM calls: 0",
        "Runtime OpenAI requests: 0",
      );
    } catch (error) {
      const stopped =
        this.options.signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      telemetry.state = stopped ? "Stopped" : "Failed";
      telemetry.error = safeTelemetryMessage(error);
      telemetry.redactedLog.push(
        stopped
          ? "Runtime stopped by the user."
          : `Runtime failed: ${telemetry.error}`,
      );
      const attributed = error as { step?: CompiledStep };
      if (
        attributed.step &&
        !telemetry.steps.some((entry) => entry.stepId === attributed.step?.id)
      ) {
        telemetry.steps.push({
          stepId: attributed.step.id,
          pageContextId: attributed.step.pageContextId,
          action: attributed.step.action,
          status: stopped ? "stopped" : "failed",
          durationMs: 0,
          message: telemetry.error,
        });
      }
    } finally {
      if (this.#continuationConfirmationCount > 0)
        telemetry.redactedLog.push(
          `Accepted ${this.#continuationConfirmationCount} permitted continuation confirmation${this.#continuationConfirmationCount === 1 ? "" : "s"}.`,
        );
      telemetry.finishedAt = new Date().toISOString();
      telemetry.extractionAudit = [...this.#extractionAudit];
      if (loop)
        telemetry.loop = {
          requestedIterations,
          completedIterations,
          duplicateProtectionTriggered,
        };
      await this.#cleanupTransientHandlers();
    }
    return RuntimeTelemetrySchema.parse(telemetry);
  }

  async #installNetworkGuard() {
    if (this.#routeInstalled) return;
    this.#routeInstalled = true;
    this.#networkHandler = async (route) => {
      if (isOpenAIUrl(route.request().url())) {
        this.#blockedOpenAIAttempts += 1;
        await route.abort("blockedbyclient");
        return;
      }
      await route.fallback();
    };
    await this.options.context.route("**/*", this.#networkHandler);
    await this.options.context.routeWebSocket(
      (url) => isOpenAIUrl(url.toString()),
      (webSocket) => {
        this.#blockedOpenAIAttempts += 1;
        void webSocket.close({
          code: 1008,
          reason: "OpenAI WebSocket blocked by deterministic runtime policy.",
        });
      },
    );
  }

  #resolveStepValue(step: CompiledStep) {
    if (step.value?.kind === "literal") return step.value.value;
    if (step.value?.kind === "runtime-variable") {
      const variableName = step.value.name;
      const value = this.#ephemeralValues.get(variableName);
      if (value === undefined)
        throw new Error(`Missing ephemeral runtime variable: ${variableName}`);
      const transformed = applyRuntimeValueTransforms(
        value,
        step.valueTransforms,
      );
      const audit = [...this.#extractionAudit]
        .reverse()
        .find((entry) => entry.variableName === variableName);
      if (audit) {
        audit.numericCandidates = transformed.audit.numericCandidates;
        audit.excludedNumericCandidates =
          transformed.audit.excludedNumericCandidates;
        audit.eligibleNumberFound = transformed.audit.eligibleNumberFound;
      }
      return transformed.value;
    }
    return resolveValueReference(
      step.valueRef,
      step.localLiteral,
      this.#variables,
    );
  }

  #resetIterationState() {
    this.#pages.resolved.clear();
    this.#pages.runtimePopups.clear();
    this.#pages.closedContexts.clear();
    this.#ephemeralValues.clear();
    this.#outcomeBaselines.clear();
    this.#activeDialog = undefined;
    this.#dialogCursor = 0;
    this.#continuationResumePending = false;
    this.#continuationSkippedPopupContexts.clear();
  }

  #loopAnchorStep(loop: CompiledLoop) {
    return this.#workflow.steps.find(
      (step) =>
        loop.templateStepIds.includes(step.id) &&
        step.action === "click" &&
        Boolean(step.target),
    );
  }

  async #fingerprintLoopAnchor(locator: Locator) {
    const signature = await locator.evaluate(async (element) => {
      const row = element.closest("tr,[role=row],li");
      let identityEvidence = "";
      let evidenceNode: Element | null = element;
      while (evidenceNode) {
        const tagName = evidenceNode.tagName.toLowerCase();
        if (
          tagName === "tr" ||
          tagName === "li" ||
          tagName === "form" ||
          evidenceNode.getAttribute("role") === "row"
        )
          identityEvidence += evidenceNode.outerHTML;
        evidenceNode = evidenceNode.parentElement;
      }
      const structuralPosition: string[] = [];
      let current: Element | null = element;
      while (current?.parentElement) {
        const parent: Element = current.parentElement;
        structuralPosition.push(
          `${current.tagName.toLowerCase()}:${Array.from(parent.children).indexOf(current)}`,
        );
        current = parent;
      }
      const anchor =
        element instanceof HTMLAnchorElement ? element : element.closest("a");
      const href = anchor?.href ?? "";
      let canonicalPeerOrdinal = -1;
      if (anchor) {
        const anchorUrl = new URL(anchor.href);
        const canonicalHref = `${anchorUrl.origin}${anchorUrl.pathname}`;
        let matchingPeerCount = 0;
        const links = document.querySelectorAll("a[href]");
        for (const link of links) {
          if (!(link instanceof HTMLAnchorElement)) continue;
          const linkUrl = new URL(link.href);
          if (`${linkUrl.origin}${linkUrl.pathname}` !== canonicalHref)
            continue;
          if (link === anchor) {
            canonicalPeerOrdinal = matchingPeerCount;
            break;
          }
          matchingPeerCount += 1;
        }
      }
      const rowText = String(row?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const hrefDigestBytes = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(href)),
      );
      let hrefDigest = "";
      for (const byte of hrefDigestBytes)
        hrefDigest += byte.toString(16).padStart(2, "0");
      const rowDigestBytes = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(rowText),
        ),
      );
      let rowDigest = "";
      for (const byte of rowDigestBytes)
        rowDigest += byte.toString(16).padStart(2, "0");
      const identityDigestBytes = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(identityEvidence),
        ),
      );
      let identityDigest = "";
      for (const byte of identityDigestBytes)
        identityDigest += byte.toString(16).padStart(2, "0");
      return [
        element.tagName.toLowerCase(),
        hrefDigest,
        rowDigest,
        identityDigest,
        String(canonicalPeerOrdinal),
        structuralPosition.join("/"),
      ].join("|");
    });
    return sha256(signature);
  }

  async #currentLoopItemFingerprint(
    loop: CompiledLoop,
    seenFingerprints: ReadonlySet<string>,
  ) {
    const anchor = this.#loopAnchorStep(loop);
    if (!anchor) return sha256(`${loop.id}:${this.#loopIteration}`);
    const canonicalHref = runtimeLocatorAttempts(anchor).find(({ rule }) =>
      Boolean(rule.canonicalHref),
    )?.rule.canonicalHref;
    if (canonicalHref) {
      const root = await this.#resolveContext(anchor);
      const canonicalLinks = locatorForRule(root, {
        strategy: "canonical-href",
        canonicalHref,
      });
      const count = await canonicalLinks.count().catch(() => 0);
      for (let ordinal = 0; ordinal < count; ordinal += 1) {
        const locator = canonicalLinks.nth(ordinal);
        if (!(await locator.isVisible().catch(() => false))) continue;
        if (!(await locator.isEnabled().catch(() => false))) continue;
        const fingerprint = await this.#fingerprintLoopAnchor(locator);
        if (seenFingerprints.has(fingerprint)) continue;
        this.#loopAnchorOrdinal = ordinal;
        return fingerprint;
      }
      if (this.#loopIteration > 0) return undefined;
    }
    let resolved: {
      locator?: Locator;
      candidate?: LocatorCandidate | undefined;
    };
    try {
      resolved = await this.#resolveLocator(anchor);
    } catch (error) {
      if (this.#loopIteration > 0) return undefined;
      throw error;
    }
    const { locator } = resolved;
    if (!locator && this.#loopIteration > 0) return undefined;
    if (!locator)
      throw new Error(
        "The bounded workflow has no deterministic record anchor.",
      );
    return this.#fingerprintLoopAnchor(locator);
  }

  #recordKeywordAudit(variableName: string, keyword: string, matched: boolean) {
    const audit = [...this.#extractionAudit]
      .reverse()
      .find((entry) => entry.variableName === variableName);
    if (!audit) return;
    const existing = audit.keywordChecks.find(
      (entry) => entry.keyword === keyword,
    );
    if (existing) existing.matched = matched;
    else audit.keywordChecks.push({ keyword, matched });
  }

  #installDialogHandler() {
    const expected = this.#workflow.steps.filter(
      (step) => step.action === "dialog",
    );
    const handler = async (dialog: Dialog) => {
      const step = expected[this.#dialogCursor];
      const continuationPolicy = this.#workflow.continuationConfirmationPolicy;
      if (
        continuationPolicy &&
        isPermittedContinuationPrompt(dialog.message())
      ) {
        if (
          this.#continuationConfirmationCount >=
          continuationPolicy.maximumAcceptsPerRun
        ) {
          await dialog.dismiss();
          this.#continuationDialogFailure = new Error(
            "Permitted continuation confirmation limit was exceeded.",
          );
          return;
        }
        this.#continuationConfirmationCount += 1;
        await dialog.accept();
        this.#continuationResumePending = true;
        return;
      }
      if (continuationPolicy && !step) {
        await dialog.dismiss();
        this.#continuationDialogFailure = new Error(
          "Unexpected browser dialog did not match the configured continuation policy.",
        );
        return;
      }
      const response = step?.name.includes("dismissed")
        ? "dismissed"
        : "accepted";
      this.#dialogCursor += 1;
      this.#activeDialog = { type: dialog.type(), response };
      if (response === "accepted") await dialog.accept();
      else await dialog.dismiss();
    };
    this.#dialogHandler = handler;
    this.#pageDialogListener = (page) => page.on("dialog", handler);
    for (const page of this.options.context.pages()) page.on("dialog", handler);
    this.options.context.on("page", this.#pageDialogListener);
  }

  #throwContinuationDialogFailure() {
    if (this.#continuationDialogFailure) throw this.#continuationDialogFailure;
  }

  #affirmativeContinuationControls(scope: Locator) {
    return scope
      .getByRole("button", { name: /^\s*oui\s*$/i })
      .or(scope.getByRole("link", { name: /^\s*oui\s*$/i }))
      .or(
        scope.locator(
          'input[type="button"][value="oui" i],input[type="submit"][value="oui" i]',
        ),
      );
  }

  async #acceptHtmlContinuationConfirmation() {
    const continuationPolicy = this.#workflow.continuationConfirmationPolicy;
    if (!continuationPolicy) return false;
    const promptPattern = /voulez[\s\u00a0-]*vous[\s\u00a0]+continuer/i;
    const dialogSelector =
      'dialog,[role="dialog"],[aria-modal="true"],.modal,.ui-dialog';
    const mainContext = this.#resolvedMainContext();
    const mainResolved = mainContext
      ? this.#pages.resolved.get(mainContext.id)
      : undefined;
    const mainPage = mainResolved
      ? "mainFrame" in mainResolved
        ? (mainResolved as Page)
        : (mainResolved as Frame).page()
      : undefined;
    const matches: Array<{
      page: Page;
      scope: Locator;
      control: Locator;
      semantic: boolean;
    }> = [];
    let matchedConfirmation = false;
    for (const page of this.options.context.pages()) {
      if (page.isClosed()) continue;
      const roots: Array<Page | Frame> = [
        page,
        ...page.frames().filter((frame) => frame !== page.mainFrame()),
      ];
      for (const root of roots) {
        const semanticContainers = root
          .locator(dialogSelector)
          .filter({ hasText: promptPattern });
        const visibleSemanticScopes: Locator[] = [];
        const semanticCount = await semanticContainers.count().catch(() => 0);
        for (let index = 0; index < semanticCount; index += 1) {
          const scope = semanticContainers.nth(index);
          if (!(await scope.isVisible().catch(() => false))) continue;
          const nested = scope
            .locator(dialogSelector)
            .filter({ hasText: promptPattern });
          if ((await nested.count().catch(() => 0)) > 0) continue;
          visibleSemanticScopes.push(scope);
        }
        const scopes = [...visibleSemanticScopes];
        if (scopes.length === 0) {
          const body = root.locator("body").filter({ hasText: promptPattern });
          if (await body.isVisible().catch(() => false)) {
            const bodyControls = this.#affirmativeContinuationControls(body);
            const bodyControlCount = await bodyControls.count().catch(() => 0);
            let visibleBodyControl = false;
            for (let index = 0; index < bodyControlCount; index += 1) {
              const control = bodyControls.nth(index);
              if (
                (await control.isVisible().catch(() => false)) &&
                (await control.isEnabled().catch(() => false))
              ) {
                visibleBodyControl = true;
                break;
              }
            }
            if (visibleBodyControl) scopes.push(body);
          }
        }
        for (const scope of scopes) {
          matchedConfirmation = true;
          const controls = this.#affirmativeContinuationControls(scope);
          const controlCount = await controls.count().catch(() => 0);
          for (let index = 0; index < controlCount; index += 1) {
            const control = controls.nth(index);
            if (!(await control.isVisible().catch(() => false))) continue;
            if (!(await control.isEnabled().catch(() => false))) continue;
            matches.push({
              page,
              scope,
              control,
              semantic: visibleSemanticScopes.includes(scope),
            });
          }
        }
      }
    }
    if (!matchedConfirmation) return false;
    if (matches.length !== 1)
      throw new Error(
        "Continuation confirmation did not expose exactly one visible enabled affirmative control.",
      );
    if (
      this.#continuationConfirmationCount >=
      continuationPolicy.maximumAcceptsPerRun
    )
      throw new Error(
        "Permitted continuation confirmation limit was exceeded.",
      );
    const match = matches[0]!;
    if (mainPage && match.page !== mainPage)
      this.#permittedContinuationPages.add(match.page);
    await match.control.click({ timeout: this.#timeout });
    this.#continuationConfirmationCount += 1;
    this.#continuationResumePending = true;
    if (match.semantic) {
      const deadline = Date.now() + Math.min(this.#timeout, 2_000);
      while (
        !match.page.isClosed() &&
        (await match.scope.isVisible().catch(() => false)) &&
        Date.now() < deadline
      ) {
        throwIfStopped(this.options.signal);
        await waitForAbortableTimeout(20, this.options.signal);
      }
    } else if (!match.page.isClosed()) {
      await waitForAbortableTimeout(100, this.options.signal);
    }
    return true;
  }

  async #settleContinuationConfirmation(maximumWaitMs: number) {
    if (!this.#workflow.continuationConfirmationPolicy) return false;
    const initialCount = this.#continuationConfirmationCount;
    const deadline = Date.now() + maximumWaitMs;
    do {
      this.#throwContinuationDialogFailure();
      if (await this.#acceptHtmlContinuationConfirmation()) return true;
      if (this.#continuationConfirmationCount > initialCount) return true;
      if (Date.now() >= deadline) break;
      await waitForAbortableTimeout(25, this.options.signal);
    } while (true);
    this.#throwContinuationDialogFailure();
    return this.#continuationConfirmationCount > initialCount;
  }

  async #resolveConfiguredContinuationResume(
    failedStep: CompiledStep,
    failedStepIndex: number,
    error: unknown,
  ) {
    const policy = this.#workflow.continuationConfirmationPolicy;
    if (
      !policy?.resumeStepId ||
      !this.#continuationResumePending ||
      !failedStep.expectsPopupContextId ||
      !(error instanceof Error) ||
      !error.message.startsWith(
        "No deterministic locator resolved the demonstrated target",
      )
    )
      return;
    const resumeStepIndex = this.#workflow.steps.findIndex(
      (candidate) => candidate.id === policy.resumeStepId,
    );
    if (resumeStepIndex <= failedStepIndex) return;
    const resumeStep = this.#workflow.steps[resumeStepIndex];
    if (!resumeStep?.target || !["click", "submit"].includes(resumeStep.action))
      return;
    const failedContext = this.#workflow.pageContexts.find(
      (candidate) => candidate.id === failedStep.pageContextId,
    );
    const resumeContext = this.#workflow.pageContexts.find(
      (candidate) => candidate.id === resumeStep.pageContextId,
    );
    if (
      failedContext?.role !== "main" ||
      resumeContext?.role !== "main" ||
      failedContext.pageId !== resumeContext.pageId ||
      failedContext.origin !== resumeContext.origin ||
      failedContext.pathname !== resumeContext.pathname
    )
      return;
    const popupContextId = failedStep.expectsPopupContextId;
    const hasOnlyTransientPopupBranch = this.#workflow.steps
      .slice(failedStepIndex + 1, resumeStepIndex)
      .every(
        (candidate) =>
          candidate.pageContextId === popupContextId ||
          (candidate.action === "focus" &&
            candidate.pageContextId === resumeStep.pageContextId),
      );
    if (!hasOnlyTransientPopupBranch) return;
    try {
      const resolved = await this.#resolveLocator(resumeStep);
      if (!resolved.locator || !resolved.candidate) return;
    } catch {
      return;
    }
    this.#continuationResumePending = false;
    this.#continuationSkippedPopupContexts.add(popupContextId);
    return resumeStep;
  }

  async #cleanupTransientHandlers() {
    if (this.#dialogHandler) {
      for (const page of this.options.context.pages()) {
        page.off("dialog", this.#dialogHandler);
      }
    }
    if (this.#pageDialogListener) {
      this.options.context.off("page", this.#pageDialogListener);
    }
    if (this.#networkHandler) {
      await this.options.context
        .unroute("**/*", this.#networkHandler)
        .catch(() => undefined);
    }
  }

  #entryMainContext() {
    const contexts = this.#workflow.pageContexts;
    const stepContext = contexts.find(
      (context) => context.id === this.#workflow.steps[0]?.pageContextId,
    );
    let current = stepContext;
    const visited = new Set<string>();
    while (current?.parentId && current.role !== "main") {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      current = contexts.find(
        (candidate) => candidate.id === current?.parentId,
      );
    }
    if (current?.role === "main") {
      if (stepContext?.role === "frame") {
        const sameDocumentMain = contexts.find(
          (context) =>
            context.role === "main" &&
            context.pageId === stepContext.pageId &&
            context.documentOrdinal === stepContext.documentOrdinal &&
            context.origin !== "null" &&
            context.pathname !== "blank" &&
            context.status !== "closed",
        );
        if (sameDocumentMain) return sameDocumentMain;
      }
      return current;
    }
    return (
      [...contexts]
        .reverse()
        .find(
          (context) =>
            context.role === "main" &&
            ["active", "open"].includes(context.status),
        ) ?? contexts.find((context) => context.role === "main")
    );
  }

  #resolvedMainContext() {
    const entry = this.#entryMainContext();
    if (entry && this.#pages.resolved.has(entry.id)) return entry;
    return this.#workflow.pageContexts.find(
      (context) =>
        context.role === "main" && this.#pages.resolved.has(context.id),
    );
  }

  #forgetResolvedPage(page: Page) {
    for (const [contextId, resolved] of this.#pages.resolved) {
      const resolvedPage =
        "mainFrame" in resolved
          ? (resolved as Page)
          : (resolved as Frame).page();
      if (resolvedPage === page) this.#pages.resolved.delete(contextId);
    }
  }

  async #rewindToEntryMainContext(
    entry: CompiledPageContext,
    openPages: Page[],
  ) {
    const sameTabDocuments = this.#workflow.pageContexts
      .filter(
        (context) =>
          context.role === "main" &&
          context.pageId === entry.pageId &&
          context.origin === entry.origin &&
          context.documentOrdinal >= entry.documentOrdinal,
      )
      .sort((left, right) => left.documentOrdinal - right.documentOrdinal);
    for (const page of openPages) {
      const current = [...sameTabDocuments]
        .reverse()
        .find(
          (context) =>
            context.documentOrdinal > entry.documentOrdinal &&
            canonicalMatches(page.url(), context),
        );
      if (!current) continue;
      let traversed = 0;
      let aligned = true;
      for (
        let ordinal = current.documentOrdinal - 1;
        ordinal >= entry.documentOrdinal;
        ordinal -= 1
      ) {
        const expected = sameTabDocuments.find(
          (context) => context.documentOrdinal === ordinal,
        );
        if (!expected) {
          aligned = false;
          break;
        }
        await page
          .goBack({
            waitUntil: "domcontentloaded",
            timeout: this.#timeout,
          })
          .catch(() => undefined);
        traversed += 1;
        if (!canonicalMatches(page.url(), expected)) {
          aligned = false;
          break;
        }
      }
      if (aligned && canonicalMatches(page.url(), entry)) {
        this.#forgetResolvedPage(page);
        this.#pages.resolved.set(entry.id, page);
        return true;
      }
      while (traversed > 0) {
        await page
          .goForward({
            waitUntil: "domcontentloaded",
            timeout: this.#timeout,
          })
          .catch(() => undefined);
        traversed -= 1;
      }
    }
    return false;
  }

  async #resolveInitialContexts() {
    const openPages = this.options.context
      .pages()
      .filter((page) => !page.isClosed());
    for (const pageContext of this.#workflow.pageContexts) {
      if (pageContext.role === "popup" || pageContext.status === "closed")
        continue;
      if (pageContext.role === "frame") continue;
      const exact = openPages.find((page) =>
        canonicalMatches(page.url(), pageContext),
      );
      if (exact) this.#pages.resolved.set(pageContext.id, exact);
    }
    const requiredMain = this.#entryMainContext();
    if (requiredMain && !this.#pages.resolved.has(requiredMain.id)) {
      if (await this.#rewindToEntryMainContext(requiredMain, openPages)) return;
      const firstMainTarget = this.#workflow.steps.find(
        (step) => step.target?.frame.role === "main",
      )?.target?.frame;
      const historicalStart = firstMainTarget
        ? openPages.find((page) => {
            try {
              const canonical = canonicalizeUrl(page.url());
              return (
                canonical.origin === firstMainTarget.origin &&
                canonical.pathname === firstMainTarget.pathname
              );
            } catch {
              return false;
            }
          })
        : undefined;
      if (historicalStart)
        this.#pages.resolved.set(requiredMain.id, historicalStart);
      else
        throw new Error(
          `Main application page is not at the demonstrated start location.`,
        );
    }
  }

  async #resolveContext(step: CompiledStep): Promise<LocatorRoot> {
    const already = this.#pages.resolved.get(step.pageContextId);
    if (already) {
      const expected = this.#workflow.pageContexts.find(
        (candidate) => candidate.id === step.pageContextId,
      );
      const stillAvailable =
        "isDetached" in already
          ? !(already as Frame).isDetached()
          : !(already as Page).isClosed();
      const stillAtDocument =
        !expected ||
        ("url" in already && canonicalMatches(already.url(), expected));
      if (stillAvailable && stillAtDocument) return already;
      this.#pages.resolved.delete(step.pageContextId);
    }
    const pageContext = this.#workflow.pageContexts.find(
      (candidate) => candidate.id === step.pageContextId,
    );
    if (!pageContext)
      throw new Error(`Unknown compiled page context ${step.pageContextId}.`);
    if (pageContext.role === "popup") {
      const popup = this.#pages.runtimePopups.get(pageContext.id);
      if (!popup || popup.isClosed())
        throw new Error(
          `Expected popup context ${pageContext.id} is not open.`,
        );
      await this.#waitForExpectedPopupDocument(popup, pageContext.id);
      this.#pages.resolved.set(pageContext.id, popup);
      return popup;
    }
    if (pageContext.role === "frame") {
      const parent = pageContext.parentId
        ? this.#pages.resolved.get(pageContext.parentId)
        : undefined;
      const page =
        parent && "frames" in parent
          ? (parent as Page)
          : this.options.context
              .pages()
              .find((candidate) => !candidate.isClosed());
      if (!page) throw new Error("Parent page for frame is unavailable.");
      const identity = step.target?.descriptor?.frame ?? step.target?.frame;
      const candidates: Frame[] = [];
      for (const candidate of page.frames()) {
        if (candidate === page.mainFrame() || candidate.isDetached()) continue;
        const canonicalMatch = canonicalMatches(candidate.url(), pageContext);
        const inspectableOpaqueMatch =
          pageContext.origin === "opaque:" &&
          pageContext.sameOriginInspectable &&
          (await isTopDocumentInspectable(candidate));
        if (!canonicalMatch && !inspectableOpaqueMatch) continue;
        if (identity?.name && candidate.name() !== identity.name) continue;
        if (identity?.title) {
          const title = await candidate.title().catch(() => "");
          if (runtimeTitlePattern(title) !== identity.title) continue;
        }
        candidates.push(candidate);
      }
      if (candidates.length !== 1)
        throw new Error(
          candidates.length === 0
            ? `Same-origin frame ${pageContext.origin}${pageContext.pathname} is unavailable.`
            : `Same-origin frame ${pageContext.origin}${pageContext.pathname} is ambiguous.`,
        );
      const frame = candidates[0]!;
      this.#pages.resolved.set(pageContext.id, frame);
      return frame;
    }
    const page = this.options.context
      .pages()
      .find(
        (candidate) =>
          !candidate.isClosed() &&
          canonicalMatches(candidate.url(), pageContext),
      );
    if (!page)
      throw new Error(
        `Page context ${step.pageContextId} could not be resolved.`,
      );
    this.#pages.resolved.set(pageContext.id, page);
    return page;
  }

  async #waitForExpectedPopupDocument(popup: Page, pageContextId: string) {
    const expected = this.#workflow.pageContexts.find(
      (candidate) => candidate.id === pageContextId,
    );
    if (!expected || canonicalMatches(popup.url(), expected)) return;
    await popup.waitForURL(
      (url) => canonicalMatches(url.toString(), expected),
      {
        waitUntil: "domcontentloaded",
        timeout: this.#timeout,
      },
    );
  }

  #waitForExpectedPopup(pageContextId: string) {
    const expected = this.#workflow.pageContexts.find(
      (candidate) => candidate.id === pageContextId,
    );
    if (!expected)
      return Promise.reject(
        new Error(`Unknown expected popup context ${pageContextId}.`),
      );
    const existingPages = new Set(this.options.context.pages());
    return new Promise<Page>((resolve, reject) => {
      const observedCanonicalPaths = new Set<string>();
      const pageListeners = new Map<Page, (frame: Frame) => void>();
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        this.options.context.off("page", onPage);
        for (const [page, listener] of pageListeners)
          page.off("framenavigated", listener);
      };
      const finish = (page: Page) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(page);
      };
      const inspect = (page: Page) => {
        if (page.isClosed()) return;
        try {
          const canonical = canonicalizeUrl(page.url());
          observedCanonicalPaths.add(
            `${canonical.origin}${canonical.pathname}`,
          );
        } catch {
          observedCanonicalPaths.add("non-canonical-popup");
        }
        if (canonicalMatches(page.url(), expected)) finish(page);
      };
      const onPage = (page: Page) => {
        if (existingPages.has(page) || pageListeners.has(page)) return;
        const listener = (frame: Frame) => {
          if (frame === page.mainFrame()) inspect(page);
        };
        pageListeners.set(page, listener);
        page.on("framenavigated", listener);
        inspect(page);
      };
      this.options.context.on("page", onPage);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new Error(
            `Expected popup document did not open. Redacted observed paths: ${JSON.stringify([...observedCanonicalPaths])}.`,
          ),
        );
      }, this.#timeout);
    });
  }

  async #closeReadOnlyPopupAfterExtraction(step: CompiledStep) {
    const pageContext = this.#workflow.pageContexts.find(
      (candidate) => candidate.id === step.pageContextId,
    );
    if (pageContext?.role !== "popup") return;
    const hasExplicitClose = this.#workflow.steps.some(
      (candidate) =>
        candidate.action === "popup-close" &&
        candidate.pageContextId === step.pageContextId,
    );
    if (hasExplicitClose) return;
    await waitForAbortableTimeout(100, this.options.signal);
    const popup = this.#pages.runtimePopups.get(step.pageContextId);
    if (popup && !popup.isClosed()) await popup.close();
    this.#pages.closedContexts.add(step.pageContextId);
    this.#pages.resolved.delete(step.pageContextId);
  }

  async #waitForPopupClosure(popup: Page) {
    const deadline = Date.now() + this.#timeout;
    while (!popup.isClosed() && Date.now() < deadline) {
      throwIfStopped(this.options.signal);
      await waitForAbortableTimeout(20, this.options.signal);
    }
    if (!popup.isClosed())
      throw new Error("Expected popup did not close within the step timeout.");
  }

  async #resolveLegacyDynamicFormControl(
    root: LocatorRoot,
    step: CompiledStep,
  ): Promise<
    { locator: Locator; candidate: LocatorCandidate | undefined } | undefined
  > {
    if (!step.target || !["fill", "select", "keyboard"].includes(step.action))
      return;
    const recordedName = step.target.stableAttributes.name;
    const dynamicNameMatch = recordedName?.match(/^(.+_)\d+$/);
    if (!dynamicNameMatch?.[1]) return;
    const tagName = step.target.tag;
    if (!["input", "select", "textarea"].includes(tagName)) return;
    const locator = root
      .locator(`${tagName}[name^="${escapeForAttribute(dynamicNameMatch[1])}"]`)
      .first();
    if ((await locator.count().catch(() => 0)) !== 1) return;
    if (!(await locator.isVisible().catch(() => false))) return;
    if (!(await locator.isEnabled().catch(() => false))) return;
    if (!(await locator.isEditable().catch(() => false))) return;
    return { locator, candidate: selectedFirst(step)[0] };
  }

  #locatorResolutionTimeout(step: CompiledStep) {
    const policy = this.#workflow.continuationConfirmationPolicy;
    if (
      this.#continuationResumePending &&
      policy?.resumeStepId &&
      step.expectsPopupContextId
    )
      return Math.min(this.#timeout, 750);
    return this.#timeout;
  }

  async #resolveLocator(step: CompiledStep): Promise<{
    locator?: Locator;
    candidate?: LocatorCandidate | undefined;
  }> {
    if (!step.target) return {};
    const root = await this.#resolveContext(step);
    await this.options.animation?.beforeStep?.({
      step,
      phase: "Resolving target",
    });
    const deadline = Date.now() + this.#locatorResolutionTimeout(step);
    let lastAttemptEvidence: Array<{
      strategy: LocatorCandidate["strategy"];
      count: number;
      visible: boolean;
      enabled: boolean | "not-required";
      editable: boolean | "not-required";
    }> = [];
    do {
      const currentAttemptEvidence: typeof lastAttemptEvidence = [];
      for (const { candidate, rule } of this.#locatorAttempts(step)) {
        const locator = locatorForRule(root, rule);
        const count = await locator.count().catch(() => 0);
        const visible =
          count === 1 && (await locator.isVisible().catch(() => false));
        const enabled =
          step.action === "extract"
            ? "not-required"
            : count === 1 && (await locator.isEnabled().catch(() => false));
        const editable = ["fill", "select"].includes(step.action)
          ? count === 1 && (await locator.isEditable().catch(() => false))
          : "not-required";
        currentAttemptEvidence.push({
          strategy: candidate.strategy,
          count,
          visible,
          enabled,
          editable,
        });
        if (count !== 1 || !visible || enabled === false || editable === false)
          continue;
        return { locator, candidate };
      }
      lastAttemptEvidence = currentAttemptEvidence;
      const dynamicFormControl = await this.#resolveLegacyDynamicFormControl(
        root,
        step,
      );
      if (dynamicFormControl) return dynamicFormControl;
      if (step.action === "select") {
        const demonstratedValue = this.#resolveStepValue(step);
        if (demonstratedValue !== undefined) {
          const optionSelector = `option[value="${escapeForAttribute(demonstratedValue)}"]`;
          const selectionSelector = `select:has(${optionSelector})`;
          const formNames = [
            ...new Set(
              step.locatorCandidates
                .map((candidate) => candidate.rule.formName)
                .filter((value): value is string => Boolean(value)),
            ),
          ];
          const selectors = [
            ...formNames.map(
              (formName) =>
                `form[name="${escapeForAttribute(formName)}"] ${selectionSelector}`,
            ),
            selectionSelector,
          ];
          for (const selector of selectors) {
            const locator = root.locator(selector);
            if ((await locator.count().catch(() => 0)) !== 1) continue;
            if (!(await locator.isVisible().catch(() => false))) continue;
            if (!(await locator.isEnabled().catch(() => false))) continue;
            if (!(await locator.isEditable().catch(() => false))) continue;
            return {
              locator,
              candidate: selectedFirst(step)[0],
            };
          }
        }
      }
      if (Date.now() >= deadline) break;
      await waitForAbortableTimeout(50, this.options.signal);
    } while (true);
    throw new Error(
      `No deterministic locator resolved the demonstrated target for ${step.name}. Redacted locator evidence: ${JSON.stringify(lastAttemptEvidence)}.`,
    );
  }

  #locatorAttempts(step: CompiledStep) {
    const attempts = runtimeLocatorAttempts(step);
    const loop = this.#workflow.loops[0];
    const anchor = loop ? this.#loopAnchorStep(loop) : undefined;
    if (
      !loop ||
      anchor?.id !== step.id ||
      loop.nextItemRelationship !== "next-row"
    )
      return attempts;
    const shifted = attempts.flatMap(({ candidate, rule }) =>
      rule.rowIndex !== undefined && rule.columnIndex !== undefined
        ? [
            {
              candidate,
              rule: {
                ...rule,
                strategy: "same-row-column" as const,
                ordinal: this.#loopAnchorOrdinal,
                rowText: undefined,
                rowTexts: undefined,
                iconAlt: undefined,
                iconTitle: undefined,
                iconSrc: undefined,
                iconTag: undefined,
              },
            },
          ]
        : [],
    );
    const canonicalOrdinal = attempts.flatMap(({ candidate, rule }) =>
      rule.canonicalHref
        ? [
            {
              candidate,
              rule: {
                strategy: "canonical-href" as const,
                canonicalHref: rule.canonicalHref,
                ordinal: this.#loopAnchorOrdinal,
              },
            },
          ]
        : [],
    );
    return [...canonicalOrdinal, ...shifted];
  }

  #isRedundantLegacySelectionClick(step: CompiledStep, stepIndex: number) {
    if (
      step.action !== "click" ||
      step.target?.descriptor?.controlFamily !== "selection" ||
      !step.target.fingerprint
    )
      return false;
    return [stepIndex - 1, stepIndex + 1].some((neighborIndex) => {
      const neighbor = this.#workflow.steps[neighborIndex];
      return (
        neighbor?.action === "select" &&
        neighbor.pageContextId === step.pageContextId &&
        neighbor.target?.fingerprint === step.target?.fingerprint
      );
    });
  }

  #isRedundantSubmit(step: CompiledStep, stepIndex: number) {
    if (step.action !== "submit" || !step.target?.fingerprint) return false;
    const previous = this.#workflow.steps[stepIndex - 1];
    return (
      previous?.action === "click" &&
      previous.pageContextId === step.pageContextId &&
      previous.target?.fingerprint === step.target.fingerprint
    );
  }

  async #readEditableValue(locator: Locator) {
    return locator.evaluate((element) => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      )
        return element.value;
      return element.textContent ?? "";
    });
  }

  #extractionTransforms(step: CompiledStep) {
    if (!step.outputVariable) return [];
    return this.#workflow.steps
      .filter(
        (candidate) =>
          candidate.value?.kind === "runtime-variable" &&
          candidate.value.name === step.outputVariable,
      )
      .flatMap((candidate) => candidate.valueTransforms);
  }

  #satisfiesExtractionTransforms(
    value: string,
    transforms: CompiledStep["valueTransforms"],
  ) {
    if (transforms.length === 0) return true;
    try {
      applyRuntimeValueTransforms(value, transforms);
      return true;
    } catch {
      return false;
    }
  }

  async #recoverNearbyExtractedValue(
    step: CompiledStep,
    locator: Locator,
    originalValue: string,
  ) {
    const transforms = this.#extractionTransforms(step);
    if (transforms.length === 0) return;
    const candidates = await locator
      .evaluate((element) => {
        const results: Array<{
          value: string;
          depth: number;
          sameTag: boolean;
          descendantElements: number;
        }> = [];
        const seen = new Set<Element>();
        let scope = element.parentElement;
        for (
          let depth = 0;
          depth < 5 && scope && scope !== document.body;
          depth += 1, scope = scope.parentElement
        ) {
          const selector = [
            element.tagName.toLowerCase(),
            "span",
            "p",
            "pre",
            "textarea",
            "td",
            "div",
          ].join(",");
          for (const node of scope.querySelectorAll(selector)) {
            if (node === element || seen.has(node)) continue;
            seen.add(node);
            const box = node.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) continue;
            const value =
              node instanceof HTMLInputElement ||
              node instanceof HTMLTextAreaElement
                ? node.value
                : (node.textContent ?? "");
            if (!value.trim() || value.length > 20_000) continue;
            results.push({
              value,
              depth,
              sameTag: node.tagName === element.tagName,
              descendantElements: node.querySelectorAll("*").length,
            });
            if (results.length >= 256) return results;
          }
        }
        return results;
      })
      .catch(() => []);
    const eligible = candidates.flatMap((candidate) => {
      if (candidate.value === originalValue) return [];
      try {
        const transformed = applyRuntimeValueTransforms(
          candidate.value,
          transforms,
        );
        const score =
          (transformed.audit.excludedNumericCandidates > 0 ? 100_000 : 0) +
          (candidate.sameTag ? 10_000 : 0) -
          candidate.depth * 1_000 -
          candidate.descendantElements * 10 -
          Math.min(candidate.value.length, 20_000) / 100;
        return [{ ...candidate, score }];
      } catch {
        return [];
      }
    });
    eligible.sort((left, right) => right.score - left.score);
    const selected = eligible[0];
    if (!selected) return;
    const runnerUp = eligible[1];
    if (runnerUp && Math.abs(selected.score - runnerUp.score) < 0.001) return;
    return selected.value;
  }

  async #readExtractedValue(step: CompiledStep, locator: Locator) {
    const transforms = this.#extractionTransforms(step);
    if (step.extractionSelection?.mode === "text-range") {
      const result = await locator
        .evaluate((element, evidence) => {
          const nodeAtPath = (root: Node, path: number[]) => {
            let current: Node | undefined = root;
            for (const index of path) current = current?.childNodes[index];
            return current;
          };
          const start = nodeAtPath(element, evidence.startPath);
          const end = nodeAtPath(element, evidence.endPath);
          if (!start || !end)
            return {
              value:
                element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement
                  ? element.value
                  : (element.textContent ?? ""),
              replayed: false,
            };
          const range = element.ownerDocument.createRange();
          try {
            range.setStart(start, evidence.startOffset);
            range.setEnd(end, evidence.endOffset);
          } catch {
            return {
              value: element.textContent ?? "",
              replayed: false,
            };
          }
          const selection = element.ownerDocument.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return { value: range.toString(), replayed: true };
        }, step.extractionSelection)
        .catch(() => undefined);
      if (
        result &&
        this.#satisfiesExtractionTransforms(result.value, transforms)
      )
        return result;
      if (result) {
        const recovered = await this.#recoverNearbyExtractedValue(
          step,
          locator,
          result.value,
        );
        if (recovered !== undefined)
          return { value: recovered, replayed: false };
        return result;
      }
    }
    await locator.selectText().catch(() => undefined);
    const result = {
      value: await this.#readEditableValue(locator),
      replayed: step.extractionSelection?.mode === "element",
    };
    if (this.#satisfiesExtractionTransforms(result.value, transforms))
      return result;
    const recovered = await this.#recoverNearbyExtractedValue(
      step,
      locator,
      result.value,
    );
    return recovered === undefined
      ? result
      : { value: recovered, replayed: false };
  }

  async #verifyEnteredValue(
    locator: Locator,
    expected: string,
    requireBacking: boolean,
  ) {
    const result = await locator.evaluate(
      (element, details) => {
        const visibleValue =
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
            ? element.value
            : (element.textContent ?? "");
        const selector = (element as HTMLElement).dataset.vcBacking;
        const backing = selector
          ? element.ownerDocument.querySelector(selector)
          : undefined;
        const backingMatches =
          !details.requireBacking ||
          (backing instanceof HTMLInputElement ||
          backing instanceof HTMLTextAreaElement
            ? backing.value === details.expected
            : false);
        return {
          visibleMatches: visibleValue === details.expected,
          backingMatches,
        };
      },
      { expected, requireBacking },
    );
    if (!result.visibleMatches)
      throw new Error(
        "Text entry verification failed: target value did not match.",
      );
    if (!result.backingMatches)
      throw new Error(
        "Text entry verification failed: legacy backing field did not synchronize.",
      );
  }

  async #applyInputStrategy(
    locator: Locator,
    value: string,
    strategy: NonNullable<CompiledStep["inputStrategies"]>[number],
  ) {
    if (strategy === "playwright-fill" || strategy === "contenteditable-fill") {
      await locator.fill(value, { timeout: this.#timeout });
      return;
    }
    if (strategy === "sequential-keys") {
      await locator.click({ timeout: this.#timeout });
      await locator.press("ControlOrMeta+A");
      await locator.press("Backspace");
      await locator.pressSequentially(value, { delay: 0 });
      return;
    }
    if (strategy === "legacy-backing-sync") {
      await locator.fill(value, { timeout: this.#timeout });
      await locator.evaluate((element, nextValue) => {
        const selector = (element as HTMLElement).dataset.vcBacking;
        const backing = selector
          ? element.ownerDocument.querySelector(selector)
          : undefined;
        if (
          backing instanceof HTMLInputElement ||
          backing instanceof HTMLTextAreaElement
        ) {
          backing.value = nextValue;
          backing.dispatchEvent(new Event("input", { bubbles: true }));
          backing.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, value);
      return;
    }
    await locator.evaluate((element, nextValue) => {
      if (element instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(element, nextValue);
      } else if (element instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(element, nextValue);
      } else {
        element.textContent = nextValue;
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  }

  async #enterAndVerifyValue(
    step: CompiledStep,
    locator: Locator,
    value: string,
  ) {
    if (step.action === "select") {
      await locator.selectOption(value);
      if ((await this.#readEditableValue(locator)) !== value)
        throw new Error(
          "Selection verification failed: target value did not match.",
        );
      return "playwright-fill";
    }
    const strategies = step.inputStrategies ?? ["playwright-fill"];
    for (const strategy of strategies) {
      try {
        await this.#applyInputStrategy(locator, value, strategy);
        await this.#verifyEnteredValue(
          locator,
          value,
          strategy === "legacy-backing-sync" ||
            Boolean(step.target?.backingFieldSelector),
        );
        return strategy;
      } catch {
        // The demonstrated value is deliberately omitted from fallback errors.
      }
    }
    throw new Error(
      "Text entry failed during deterministic input and value-verification phase.",
    );
  }

  async #runStep(step: CompiledStep): Promise<{
    candidate?: LocatorCandidate;
    skipped?: boolean;
    message: string;
  }> {
    if (step.action === "popup-open") {
      const popup = this.#pages.runtimePopups.get(step.pageContextId);
      if (!popup)
        throw new Error(`Expected popup ${step.pageContextId} did not open.`);
      return { message: "Expected popup opened." };
    }
    if (step.action === "popup-close") {
      const popup = this.#pages.runtimePopups.get(step.pageContextId);
      if (!popup)
        throw new Error(
          `Expected popup ${step.pageContextId} was never observed.`,
        );
      await this.#waitForPopupClosure(popup);
      this.#pages.closedContexts.add(step.pageContextId);
      return {
        message: "Expected popup closed and opener remained available.",
      };
    }
    if (step.action === "dialog") {
      const deadline = Date.now() + this.#timeout;
      while (!this.#activeDialog && Date.now() < deadline) {
        throwIfStopped(this.options.signal);
        await waitForAbortableTimeout(20, this.options.signal);
      }
      if (!this.#activeDialog)
        throw new Error("Expected dialog was not observed.");
      const handled = this.#activeDialog;
      this.#activeDialog = undefined;
      return { message: `${handled.type} dialog ${handled.response}.` };
    }
    if (step.action === "navigation") {
      const pageContext = this.#workflow.pageContexts.find(
        (candidate) => candidate.id === step.pageContextId,
      );
      const page = await this.#resolveContext(step);
      if (
        pageContext &&
        page &&
        "url" in page &&
        !canonicalMatches(page.url(), pageContext)
      ) {
        throw new Error(
          "Observed navigation does not match the canonical path.",
        );
      }
      return { message: "Canonical navigation state verified." };
    }
    if (step.action === "assert") {
      return {
        message: "Demonstrated success observation deferred to final outcome.",
      };
    }
    if (step.action === "focus") {
      const root = await this.#resolveContext(step);
      if ("bringToFront" in root) await (root as Page).bringToFront();
      return { message: "Page focus restored." };
    }
    if (step.action === "wait") {
      await waitForAbortableTimeout(100, this.options.signal);
      return { message: "Deterministic wait completed." };
    }
    if (step.action === "keyboard" && step.keyboardScope === "page") {
      const root = await this.#resolveContext(step);
      const page =
        "mainFrame" in root ? (root as Page) : (root as Frame).page();
      await page.keyboard.press(step.key ?? "Enter");
      await this.#settleContinuationConfirmation(250);
      return {
        message: `Executed page-level keyboard action ${step.key ?? "Enter"} without an element locator.`,
      };
    }

    const { locator, candidate } = await this.#resolveLocator(step);
    if (!locator || !candidate)
      throw new Error(`Step ${step.id} requires a demonstrated target.`);
    await this.options.animation?.beforeStep?.({
      step,
      locator,
      phase: "Highlighting target",
    });
    throwIfStopped(this.options.signal);
    await this.options.animation?.beforeStep?.({
      step,
      locator,
      phase: "Executing action",
    });

    let popupPromise: Promise<Page> | undefined;
    if (step.expectsPopupContextId) {
      popupPromise = this.#waitForExpectedPopup(step.expectsPopupContextId);
    }
    let usedInputStrategy: string | undefined;
    if (step.action === "extract") {
      if (!step.outputVariable)
        throw new Error("Extract step is missing its ephemeral output.");
      const extracted = await this.#readExtractedValue(step, locator);
      this.#ephemeralValues.set(step.outputVariable, extracted.value);
      await locator.dispatchEvent("copy").catch(() => undefined);
      this.#extractionAudit.push({
        stepId: step.id,
        pageContextId: step.pageContextId,
        variableName: step.outputVariable,
        sourceFingerprint: step.target?.fingerprint ?? sha256(step.id),
        characterCount: extracted.value.length,
        contentSha256: sha256(extracted.value),
        structuralSelectionReplayed: extracted.replayed,
        numericCandidates: 0,
        excludedNumericCandidates: 0,
        eligibleNumberFound: false,
        keywordChecks: [],
        rawTextPersisted: false,
      });
      await this.#closeReadOnlyPopupAfterExtraction(step);
    } else if (step.action === "click")
      await locator.click({ timeout: this.#timeout });
    else if (step.action === "double-click")
      await locator.dblclick({ timeout: this.#timeout });
    else if (step.action === "fill") {
      const value = this.#resolveStepValue(step);
      usedInputStrategy = await this.#enterAndVerifyValue(
        step,
        locator,
        value ?? "",
      );
    } else if (step.action === "select") {
      const value = this.#resolveStepValue(step);
      usedInputStrategy = await this.#enterAndVerifyValue(
        step,
        locator,
        value ?? "",
      );
    } else if (step.action === "check") {
      await locator.check();
      if (!(await locator.isChecked()))
        throw new Error("Toggle verification failed after check.");
    } else if (step.action === "uncheck") {
      await locator.uncheck();
      if (await locator.isChecked())
        throw new Error("Toggle verification failed after uncheck.");
    } else if (step.action === "keyboard")
      await locator.press(step.key ?? "Enter");
    else if (step.action === "submit") {
      await locator.evaluate((element) => {
        const form =
          element instanceof HTMLFormElement
            ? element
            : element.closest("form");
        form?.requestSubmit();
      });
    } else {
      throw new Error(`Unsupported deterministic action ${step.action}.`);
    }

    if (["keyboard", "submit"].includes(step.action))
      await this.#settleContinuationConfirmation(250);
    else if (["click", "double-click"].includes(step.action))
      await this.#settleContinuationConfirmation(100);

    if (popupPromise && step.expectsPopupContextId) {
      await this.options.animation?.beforeStep?.({
        step,
        locator,
        phase: "Waiting for popup",
      });
      const popup = await popupPromise;
      this.#pages.runtimePopups.set(step.expectsPopupContextId, popup);
      this.#pages.resolved.set(step.expectsPopupContextId, popup);
      popup.on("close", () => {
        this.#pages.closedContexts.add(step.expectsPopupContextId!);
      });
      await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
      if (step.expectsPopupClosure) await this.#waitForPopupClosure(popup);
    }
    await this.options.animation?.beforeStep?.({
      step,
      locator,
      phase: "Verifying action",
    });
    await this.#verifyPostconditions(step, locator);
    await this.options.animation?.afterStep?.({ step, locator });
    return {
      candidate,
      message: `Executed ${step.action} with ${usedInputStrategy ?? candidate.strategy}.`,
    };
  }

  async #verifyPostconditions(step: CompiledStep, locator: Locator) {
    for (const condition of step.postconditions) {
      if (condition.type === "backing-field-synchronized") {
        const synchronized = await locator.evaluate((element) => {
          const html = element as HTMLElement;
          const selector = html.dataset.vcBacking;
          if (!selector) return true;
          const backing = element.ownerDocument.querySelector(selector);
          const visibleValue =
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
              ? element.value
              : (element.textContent ?? "");
          return (
            backing instanceof HTMLInputElement &&
            backing.value === visibleValue
          );
        });
        if (!synchronized)
          throw new Error("Legacy editor backing field did not synchronize.");
      } else if (condition.type === "url-path") {
        const root = this.#pages.resolved.get(step.pageContextId);
        const page =
          root && "mainFrame" in root
            ? (root as Page)
            : root && "page" in root
              ? (root as Frame).page()
              : undefined;
        const expectedPath =
          typeof condition.expected === "string"
            ? condition.expected
            : undefined;
        if (
          !page ||
          !expectedPath ||
          canonicalizeUrl(page.url()).pathname !== expectedPath
        )
          throw new Error("Demonstrated navigation postcondition failed.");
      }
    }
  }

  #outcomeBaselineKey(type: string, target: string) {
    return `${type}:${target}`;
  }

  async #captureOutcomeBaselines() {
    const mainContext = this.#resolvedMainContext();
    const mainPage = mainContext
      ? (this.#pages.resolved.get(mainContext.id) as Page | undefined)
      : undefined;
    if (!mainPage || mainPage.isClosed()) return;
    for (const evidence of this.#workflow.expectedOutcome.positiveEvidence) {
      const key = this.#outcomeBaselineKey(evidence.type, evidence.target);
      if (
        evidence.type === "relative-count-increase" ||
        evidence.type === "new-item-contains-variable"
      ) {
        this.#outcomeBaselines.set(
          key,
          await mainPage.locator(evidence.target).count(),
        );
      } else if (evidence.type === "field-unchanged") {
        this.#outcomeBaselines.set(
          key,
          await mainPage.locator(evidence.target).inputValue(),
        );
      }
    }
  }

  async #editorResetObserved(sourceStepId: string | undefined) {
    if (!sourceStepId) return false;
    const sourceStep = this.#workflow.steps.find(
      (step) => step.id === sourceStepId,
    );
    if (!sourceStep?.target) return false;
    this.#pages.resolved.delete(sourceStep.pageContextId);
    const root = await this.#resolveContext(sourceStep).catch(() => undefined);
    if (!root) return false;
    for (const candidate of selectedFirst(sourceStep)) {
      const locator = locatorForRule(root, candidate.rule);
      if ((await locator.count().catch(() => 0)) !== 1) continue;
      return locator
        .evaluate((element) => {
          const value =
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
              ? element.value
              : (element.textContent ?? "");
          return value.trim() === "";
        })
        .catch(() => false);
    }
    return false;
  }

  async #pollOutcome<T>(
    read: () => Promise<T>,
    passed: (actual: T) => boolean,
  ) {
    const deadline = Date.now() + Math.min(this.#timeout, 5_000);
    let actual = await read();
    while (!passed(actual) && Date.now() < deadline) {
      throwIfStopped(this.options.signal);
      await waitForAbortableTimeout(50, this.options.signal);
      actual = await read();
    }
    return actual;
  }

  async #verifyOutcome() {
    const checks: RuntimeTelemetry["outcomeChecks"] = [];
    const mainContext = this.#resolvedMainContext();
    const mainPage = mainContext
      ? (this.#pages.resolved.get(mainContext.id) as Page | undefined)
      : undefined;
    if (!mainPage || mainPage.isClosed())
      throw new Error(
        "Main application page closed before outcome verification.",
      );

    for (const negative of this.#workflow.expectedOutcome.negativeEvidence) {
      if (negative.type === "error-marker") {
        const visible = await mainPage
          .locator(negative.target)
          .isVisible()
          .catch(() => false);
        if (visible) throw new Error(negative.description);
      }
      if (negative.type === "unexpected-popup") {
        const unexpected = this.options.context
          .pages()
          .filter(
            (page) =>
              page !== mainPage &&
              !page.isClosed() &&
              page.url() !== "about:blank" &&
              !this.#permittedContinuationPages.has(page) &&
              ![...this.#pages.runtimePopups.values()].includes(page),
          );
        if (unexpected.length > 0) throw new Error(negative.description);
      }
    }

    for (const evidence of this.#workflow.expectedOutcome.positiveEvidence) {
      let actual: string | number | boolean = false;
      if (evidence.type === "text-visible") {
        const page =
          (this.#pages.resolved.get(evidence.pageContextId) as
            | Page
            | undefined) ?? mainPage;
        actual = await this.#pollOutcome(
          () =>
            page
              .getByText(evidence.target, { exact: true })
              .isVisible()
              .catch(() => false),
          (value) => value === evidence.expected,
        );
      } else if (evidence.type === "popup-closed") {
        actual = await this.#pollOutcome(
          async () =>
            this.#pages.closedContexts.has(evidence.pageContextId) ||
            this.#continuationSkippedPopupContexts.has(
              evidence.pageContextId,
            ) ||
            this.#pages.runtimePopups
              .get(evidence.pageContextId)
              ?.isClosed() === true,
          (value) => value === evidence.expected,
        );
      } else if (evidence.type === "navigation") {
        const context = this.#workflow.pageContexts.find(
          (candidate) => candidate.id === evidence.pageContextId,
        );
        actual = context
          ? await this.#pollOutcome(
              async () => canonicalMatches(mainPage.url(), context),
              (value) => value === evidence.expected,
            )
          : false;
        if (actual && context) this.#pages.resolved.set(context.id, mainPage);
      } else if (evidence.type === "element-visible") {
        actual = await this.#pollOutcome(
          () =>
            mainPage
              .locator(evidence.target)
              .isVisible()
              .catch(() => false),
          (value) => value === evidence.expected,
        );
      } else if (evidence.type === "field-value") {
        actual = await this.#pollOutcome(
          () =>
            mainPage
              .locator(evidence.target)
              .inputValue()
              .catch(() => ""),
          (value) => value === evidence.expected,
        );
      } else if (evidence.type === "structural-marker") {
        actual = await this.#pollOutcome(
          () =>
            mainPage
              .locator(evidence.target)
              .isVisible()
              .catch(() => false),
          (value) => value === evidence.expected,
        );
      } else if (evidence.type === "relative-count-increase") {
        const baseline = this.#outcomeBaselines.get(
          this.#outcomeBaselineKey(evidence.type, evidence.target),
        );
        actual = await this.#pollOutcome(
          async () => {
            const current = await mainPage
              .locator(evidence.target)
              .count()
              .catch(() => 0);
            return (
              current - (typeof baseline === "number" ? baseline : current)
            );
          },
          (value) =>
            typeof evidence.expected === "number" && value >= evidence.expected,
        );
      } else if (evidence.type === "new-item-contains-variable") {
        const baseline = this.#outcomeBaselines.get(
          this.#outcomeBaselineKey(evidence.type, evidence.target),
        );
        const start = typeof baseline === "number" ? baseline : 0;
        const expectedValue = evidence.variableRef
          ? resolveValueReference(
              evidence.variableRef,
              undefined,
              this.#variables,
            )
          : undefined;
        actual = await this.#pollOutcome(
          async () => {
            const count = await mainPage.locator(evidence.target).count();
            for (let index = start; index < count; index += 1) {
              const matches = await mainPage
                .locator(evidence.target)
                .nth(index)
                .evaluate(
                  (element, value) =>
                    Boolean(value && element.textContent?.includes(value)),
                  expectedValue,
                )
                .catch(() => false);
              if (matches) return true;
            }
            return false;
          },
          (value) => value === evidence.expected,
        );
      } else if (evidence.type === "editor-reset") {
        actual = await this.#pollOutcome(
          () => this.#editorResetObserved(evidence.sourceStepId),
          (value) => value === evidence.expected,
        );
      } else if (evidence.type === "field-unchanged") {
        const baseline = this.#outcomeBaselines.get(
          this.#outcomeBaselineKey(evidence.type, evidence.target),
        );
        actual = await this.#pollOutcome(
          async () => {
            const current = await mainPage
              .locator(evidence.target)
              .inputValue()
              .catch(() => "");
            return typeof baseline === "string" && current === baseline;
          },
          (value) => value === evidence.expected,
        );
      }
      const passed =
        evidence.type === "relative-count-increase" &&
        typeof actual === "number" &&
        typeof evidence.expected === "number"
          ? actual >= evidence.expected
          : actual === evidence.expected;
      checks.push({
        type: evidence.type,
        target: evidence.target,
        expected: evidence.expected,
        actual,
        passed,
      });
      if (evidence.required && !passed)
        throw new Error(
          `Required positive outcome missing: ${evidence.type} ${evidence.target}.`,
        );
    }
    if (
      this.#workflow.expectedOutcome.requireAllPositive &&
      checks.some((check) => !check.passed)
    ) {
      throw new Error("Not all required application outcomes passed.");
    }
    return checks;
  }
}
