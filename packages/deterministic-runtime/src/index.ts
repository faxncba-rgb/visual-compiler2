import type { BrowserContext, Dialog, Frame, Locator, Page } from "playwright";
import {
  CompiledWorkflowSchema,
  RuntimeTelemetrySchema,
  type CompiledLoop,
  type CompiledPageContext,
  type CompiledStep,
  type CompiledWorkflow,
  type LocatorCandidate,
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
  LocalVariableValuesSchema,
  resolveValueReference,
  type LocalVariableValues,
} from "../../workflow-variables/src";
import { canonicalizeUrl, isOpenAIUrl } from "../../shared/src";

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

function selectedFirst(step: CompiledStep) {
  const ranked = rankLocatorCandidates(step.locatorCandidates);
  const selected = ranked.find(
    (candidate) => candidate.id === step.selectedLocatorId,
  );
  return selected
    ? [selected, ...ranked.filter((candidate) => candidate.id !== selected.id)]
    : ranked;
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
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
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
  #routeInstalled = false;

  constructor(private readonly options: RuntimeOptions) {
    this.#workflow = CompiledWorkflowSchema.parse(options.workflow);
    this.#variables = LocalVariableValuesSchema.parse(options.variables);
    this.#timeout = options.stepTimeoutMs ?? 10_000;
  }

  async run(): Promise<RuntimeTelemetry> {
    const telemetry = createRuntimeTelemetry(
      this.#workflow.id,
      this.options.mode,
    );
    telemetry.state = "Running";
    this.#installDialogHandler();
    await this.#installNetworkGuard();
    try {
      await this.#resolveInitialContexts();
      for (const step of this.#workflow.steps) {
        throwIfStopped(this.options.signal);
        const started = Date.now();
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
            message: result.message,
          });
        } catch (error) {
          if (step.optional) {
            telemetry.steps.push({
              stepId: step.id,
              pageContextId: step.pageContextId,
              action: step.action,
              status: "skipped",
              durationMs: Date.now() - started,
              message: safeTelemetryMessage(error),
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
      if (this.#blockedOpenAIAttempts > 0) {
        throw new Error(
          "Runtime blocked an attempted OpenAI request; execution failed closed.",
        );
      }
      telemetry.state = "Passed";
      telemetry.redactedLog.push(
        "Application-level positive outcome verified.",
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
      telemetry.finishedAt = new Date().toISOString();
    }
    return RuntimeTelemetrySchema.parse(telemetry);
  }

  async #installNetworkGuard() {
    if (this.#routeInstalled) return;
    this.#routeInstalled = true;
    await this.options.context.route("**/*", async (route) => {
      if (isOpenAIUrl(route.request().url())) {
        this.#blockedOpenAIAttempts += 1;
        await route.abort("blockedbyclient");
        return;
      }
      await route.fallback();
    });
    await this.options.context.routeWebSocket(
      (url) => isOpenAIUrl(url.toString()),
      async (webSocket) => {
        this.#blockedOpenAIAttempts += 1;
        await webSocket.close({
          code: 1008,
          reason: "OpenAI WebSocket blocked by deterministic runtime policy.",
        });
      },
    );
  }

  #installDialogHandler() {
    const expected = this.#workflow.steps.filter(
      (step) => step.action === "dialog",
    );
    const handler = async (dialog: Dialog) => {
      const step = expected[this.#dialogCursor];
      const response = step?.name.includes("dismissed")
        ? "dismissed"
        : "accepted";
      this.#dialogCursor += 1;
      this.#activeDialog = { type: dialog.type(), response };
      if (response === "accepted") await dialog.accept();
      else await dialog.dismiss();
    };
    for (const page of this.options.context.pages()) page.on("dialog", handler);
    this.options.context.on("page", (page) => page.on("dialog", handler));
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
    const requiredMain = this.#workflow.pageContexts.find(
      (context) => context.role === "main",
    );
    if (requiredMain && !this.#pages.resolved.has(requiredMain.id)) {
      throw new Error(
        `Main application page is not at expected canonical location ${requiredMain.origin}${requiredMain.pathname}.`,
      );
    }
  }

  async #resolveContext(step: CompiledStep): Promise<LocatorRoot> {
    const already = this.#pages.resolved.get(step.pageContextId);
    if (already) return already;
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
      const frame = page
        .frames()
        .find((candidate) => canonicalMatches(candidate.url(), pageContext));
      if (!frame)
        throw new Error(
          `Same-origin frame ${pageContext.origin}${pageContext.pathname} is unavailable.`,
        );
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

  async #resolveLocator(step: CompiledStep) {
    if (!step.target) return {};
    const root = await this.#resolveContext(step);
    await this.options.animation?.beforeStep?.({
      step,
      phase: "Resolving target",
    });
    for (const candidate of selectedFirst(step)) {
      const locator = locatorForRule(root, candidate.rule);
      if ((await locator.count().catch(() => 0)) !== 1) continue;
      if (!(await locator.isVisible().catch(() => false))) continue;
      if (!(await locator.isEnabled().catch(() => false))) continue;
      if (
        ["fill", "select"].includes(step.action) &&
        !(await locator.isEditable().catch(() => false))
      )
        continue;
      return { locator, candidate };
    }
    throw new Error(
      `No deterministic locator resolved the demonstrated target for ${step.name}.`,
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
      if (!popup.isClosed()) {
        await popup.waitForEvent("close", { timeout: this.#timeout });
      }
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
      const page = this.#pages.resolved.get(step.pageContextId);
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
      const root = await this.#resolveContext(step);
      const opener =
        "mainFrame" in root ? (root as Page) : (root as Frame).page();
      popupPromise = opener.waitForEvent("popup", { timeout: this.#timeout });
    }
    if (step.action === "click")
      await locator.click({ timeout: this.#timeout });
    else if (step.action === "double-click")
      await locator.dblclick({ timeout: this.#timeout });
    else if (step.action === "fill") {
      const value = resolveValueReference(
        step.valueRef,
        step.localLiteral,
        this.#variables,
      );
      await locator.fill(value ?? "", { timeout: this.#timeout });
      await locator.evaluate((element) => {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
        const html = element as HTMLElement;
        const selector = html.dataset.vcBacking;
        if (selector) {
          const backing = element.ownerDocument.querySelector(selector);
          if (backing instanceof HTMLInputElement) {
            backing.value =
              element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement
                ? element.value
                : (element.textContent ?? "");
            backing.dispatchEvent(new Event("input", { bubbles: true }));
            backing.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      });
    } else if (step.action === "select") {
      const value = resolveValueReference(
        step.valueRef,
        step.localLiteral,
        this.#variables,
      );
      await locator.selectOption(value ?? "");
    } else if (step.action === "check") await locator.check();
    else if (step.action === "uncheck") await locator.uncheck();
    else if (step.action === "keyboard")
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
      if (step.expectsPopupClosure && !popup.isClosed()) {
        await popup.waitForEvent("close", { timeout: this.#timeout });
      }
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
      message: `Executed ${step.action} with ${candidate.strategy}.`,
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
      }
    }
  }

  async #verifyOutcome() {
    const checks: RuntimeTelemetry["outcomeChecks"] = [];
    const mainContext = this.#workflow.pageContexts.find(
      (candidate) => candidate.role === "main",
    );
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
              ![...this.#pages.runtimePopups.values()].includes(page),
          );
        if (unexpected.length > 0) throw new Error(negative.description);
      }
    }

    for (const evidence of this.#workflow.expectedOutcome.positiveEvidence) {
      let actual: string | boolean = false;
      if (evidence.type === "text-visible") {
        const page =
          (this.#pages.resolved.get(evidence.pageContextId) as
            | Page
            | undefined) ?? mainPage;
        actual = await page
          .getByText(evidence.target, { exact: true })
          .isVisible()
          .catch(() => false);
      } else if (evidence.type === "popup-closed") {
        actual =
          this.#pages.closedContexts.has(evidence.pageContextId) ||
          this.#pages.runtimePopups.get(evidence.pageContextId)?.isClosed() ===
            true;
      } else if (evidence.type === "navigation") {
        const context = this.#workflow.pageContexts.find(
          (candidate) => candidate.id === evidence.pageContextId,
        );
        actual = context ? canonicalMatches(mainPage.url(), context) : false;
      } else if (evidence.type === "element-visible") {
        actual = await mainPage
          .locator(evidence.target)
          .isVisible()
          .catch(() => false);
      } else if (evidence.type === "field-value") {
        actual = await mainPage.locator(evidence.target).inputValue();
      } else if (evidence.type === "structural-marker") {
        actual = await mainPage
          .locator(evidence.target)
          .isVisible()
          .catch(() => false);
      }
      const passed = actual === evidence.expected;
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
