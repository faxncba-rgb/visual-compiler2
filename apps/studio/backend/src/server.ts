import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { existsSync, readFileSync } from "node:fs";
import {
  appendFile,
  chmod,
  readFile,
  readdir,
  mkdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ManagedBrowser } from "../../../../packages/managed-browser/src";
import { DemonstrationRecorder } from "../../../../packages/demonstration-recorder/src";
import {
  ApplicationOutcomeValidationError,
  buildAiPayload,
  compileDemonstration,
  CompilationStageError,
  MockGeneralizationProvider,
  OpenAiCompileProvider,
  type ApplicationOutcomeValidationEvidence,
  type CompilationStage,
  type GeneralizationProvider,
} from "../../../../packages/generalization-compiler/src";
import {
  DeterministicRuntime,
  createAnimatedPresentation,
} from "../../../../packages/deterministic-runtime/src";
import {
  CompiledWorkflowSchema,
  DemonstrationSessionSchema,
  RuntimeTelemetrySchema,
  type CompiledWorkflow,
  type DemonstrationSession,
  type RuntimeTelemetry,
} from "../../../../packages/demonstration-ir/src";
import {
  StudioStateMachine,
  canonicalizeUrl,
  createId,
  redactObject,
  sha256,
} from "../../../../packages/shared/src";
import {
  assertNoLocalValuesInSession,
  LocalVariableValuesSchema,
  type LocalVariableValues,
} from "../../../../packages/workflow-variables/src";
import { safeTelemetryMessage } from "../../../../packages/telemetry/src";
import {
  LocatorValidationError,
  type LocatorValidationEvidence,
} from "../../../../packages/locator-engine/src";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(moduleDirectory, "../../frontend");
const LAST_DEMONSTRATION_VERSION = 2;
export const DEFAULT_LAB_TARGET_URL = "https://dpi-ncba.gbna-sante.fr/";

type LastDemonstrationMetadata = {
  version: typeof LAST_DEMONSTRATION_VERSION;
  targetOrigin: string;
  origin: string;
  pathname: string;
  structuralFingerprint: string;
  authenticationPersisted: false;
  queryParametersPersisted: false;
  valuesStoredSeparately: true;
};

type WorkflowLibraryEntry = {
  id: string;
  workflowId: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  origins: string[];
  pathPatterns: string[];
  actionCount: number;
  verification: CompiledWorkflow["expectedOutcome"]["verification"];
  artifactChecksum: string;
  artifactFile?: string;
  legacy: boolean;
  lastRunStatus?: RuntimeTelemetry["state"];
  lastRunAt?: string;
};

type WorkflowLibraryIndex = {
  schemaVersion: 1;
  entries: WorkflowLibraryEntry[];
};

function demonstratedEntryDocument(session: DemonstrationSession) {
  const nodes = session.pageGraph.nodes;
  let current = nodes.find(
    (node) => node.id === session.actions[0]?.pageContextId,
  );
  const visited = new Set<string>();
  while (current?.parentId && current.role !== "main") {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    current = nodes.find((candidate) => candidate.id === current?.parentId);
  }
  const demonstratedMain =
    current?.role === "main" &&
    current.origin !== "null" &&
    current.origin !== "opaque:" &&
    current.pathname !== "blank"
      ? current
      : undefined;
  return (
    demonstratedMain ??
    [...nodes]
      .reverse()
      .find(
        (node) =>
          node.role === "main" && ["active", "open"].includes(node.status),
      ) ??
    nodes.find((node) => node.id === session.pageGraph.rootId)
  );
}

function activeMainDocument(graph: DemonstrationSession["pageGraph"]) {
  return (
    [...graph.nodes]
      .reverse()
      .find(
        (node) =>
          node.role === "main" && ["active", "open"].includes(node.status),
      ) ?? graph.nodes.find((node) => node.id === graph.rootId)
  );
}

export type StudioControllerOptions = {
  targetUrl?: string;
  testMode?: boolean;
  compileApiKey?: string;
  compileProvider?: GeneralizationProvider;
};

export function resolveConfiguredTarget(options: StudioControllerOptions = {}) {
  const testMode = options.testMode ?? process.env.VC_TEST_MODE === "1";
  const value = testMode
    ? (options.targetUrl ?? process.env.VISUAL_COMPILER_TEST_TARGET_URL ?? "")
    : (options.targetUrl ??
      process.env.VISUAL_COMPILER_TARGET_URL ??
      DEFAULT_LAB_TARGET_URL);
  if (!value)
    throw new Error(
      "VISUAL_COMPILER_TEST_TARGET_URL is required in automated test mode.",
    );
  const url = new URL(value);
  if (testMode) {
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname)
    )
      throw new Error(
        "Automated tests may target only an explicit local synthetic URL.",
      );
  } else if (url.protocol !== "https:") {
    throw new Error("Normal Lab Mode requires an HTTPS target.");
  }
  return {
    testMode,
    targetUrl: url.toString(),
    canonicalTarget: canonicalizeUrl(url.toString()).canonicalUrl,
  };
}

export type StudioCompilationStage =
  | CompilationStage
  | "request-validation"
  | "artifact-persistence"
  | "state-transition";

export type StudioCompilationDiagnostic = {
  id: string;
  occurredAt: string;
  httpStatus?: number;
  stage: StudioCompilationStage | "browser-open" | "runtime-execution";
  workflowState: string;
  serverMessage: string;
  structuralEvidence?: LocatorValidationEvidence;
  applicationOutcomeEvidence?: ApplicationOutcomeValidationEvidence;
  stepId?: string;
  actionType?: string;
  targetSummary?: string;
  selectedLocator?: string;
  observedReactionSummary?: string;
  llmCalls: 0;
  openAIRequests: 0;
  teachingTraceId?: string;
};

class StudioCompilationFailure extends Error {
  readonly name = "StudioCompilationFailure";

  constructor(
    readonly stage: StudioCompilationStage,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

function findLocatorValidationEvidence(
  error: unknown,
): LocatorValidationEvidence | undefined {
  let current = error;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current instanceof LocatorValidationError) return current.evidence;
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

function findApplicationOutcomeValidationEvidence(
  error: unknown,
): ApplicationOutcomeValidationEvidence | undefined {
  let current = error;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current instanceof ApplicationOutcomeValidationError)
      return current.evidence;
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body exceeds 1 MB.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}

async function serveFile(response: ServerResponse, filename: string) {
  const extension = path.extname(filename);
  const contentType =
    extension === ".css"
      ? "text/css; charset=utf-8"
      : extension === ".js"
        ? "text/javascript; charset=utf-8"
        : "text/html; charset=utf-8";
  const body = await readFile(path.join(frontendDirectory, filename));
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  });
  response.end(body);
}

export class StudioController {
  readonly machine = new StudioStateMachine();
  readonly browser: ManagedBrowser;
  recorder: DemonstrationRecorder | undefined;
  session: DemonstrationSession | undefined;
  workflow: CompiledWorkflow | undefined;
  telemetry: RuntimeTelemetry | undefined;
  aiPayload: ReturnType<typeof buildAiPayload> | undefined;
  compilationDiagnostic: StudioCompilationDiagnostic | undefined;
  readonly studioEventLog: StudioCompilationDiagnostic[] = [];
  localValues: LocalVariableValues = {};
  generalizationInstruction = "";
  workflowName = "";
  selectedWorkflowId: string | undefined;
  workflowLibraryStatus = "No saved workflows yet.";
  readonly workflowLibraryEntries: WorkflowLibraryEntry[] = [];
  readonly testMode: boolean;
  readonly targetUrl: string;
  readonly compileProvider: GeneralizationProvider | undefined;
  #abortController: AbortController | undefined;
  #mutation: "compile" | "run" | undefined;
  #workflowLibraryLoaded = false;
  #teachingTrace:
    | {
        id: string;
        sessionId: string;
        filename: string;
        directory: string;
        status: "recording" | "closed";
      }
    | undefined;

  constructor(
    private readonly rootDirectory = process.cwd(),
    options: StudioControllerOptions = {},
  ) {
    const configured = resolveConfiguredTarget(options);
    this.testMode = configured.testMode;
    this.targetUrl = configured.targetUrl;
    this.compileProvider =
      options.compileProvider ??
      (this.testMode
        ? new MockGeneralizationProvider()
        : options.compileApiKey
          ? new OpenAiCompileProvider(options.compileApiKey)
          : undefined);
    this.browser = new ManagedBrowser({
      profileDirectory: path.join(
        rootDirectory,
        ".local",
        this.testMode
          ? `browser-profile-test-${process.pid}`
          : "browser-profile",
      ),
      headless: process.env.VC_HEADLESS === "1",
      slowMo: 0,
    });
  }

  #lastDemonstrationDirectory() {
    return path.join(this.rootDirectory, "local-data", "last-demonstration");
  }

  #workflowLibraryDirectory() {
    return path.join(this.rootDirectory, "local-data", "workflow-library");
  }

  async #beginTeachingTrace(session: DemonstrationSession) {
    const id = createId("teaching-trace");
    const directory = path.join(
      this.rootDirectory,
      "local-data",
      "teaching-traces",
      id,
    );
    const filename = path.join(directory, "trace.jsonl");
    await mkdir(directory, { recursive: true });
    const screenshot = this.testMode ? "before.synthetic.png" : undefined;
    const livePage = this.browser.context
      .pages()
      .find((page) => !page.isClosed());
    if (screenshot && livePage) {
      await livePage.screenshot({
        path: path.join(directory, screenshot),
      });
      await chmod(path.join(directory, screenshot), 0o600);
    }
    await writeFile(
      filename,
      `${JSON.stringify({
        phase: "Before",
        traceId: id,
        sessionId: session.id,
        occurredAt: session.startedAt,
        structuralSnapshot: session.beforeState
          ? {
              pageContextId: session.beforeState.pageContextId,
              fingerprint: session.beforeState.fingerprint,
              capturedAt: session.beforeState.capturedAt,
            }
          : undefined,
        screenshot: livePage ? screenshot : undefined,
        syntheticScreenshot: Boolean(screenshot && livePage),
        valuesPersisted: false,
        queryParametersPersisted: false,
        authenticationPersisted: false,
      })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    this.#teachingTrace = {
      id,
      sessionId: session.id,
      filename,
      directory,
      status: "recording",
    };
  }

  async #finishTeachingTrace(session: DemonstrationSession) {
    const trace = this.#teachingTrace;
    if (!trace || trace.sessionId !== session.id) return;
    const actionEntries = session.actions.map((action) => ({
      phase: "Action",
      traceId: trace.id,
      actionId: action.id,
      sequence: action.sequence,
      action: action.action,
      pageContextId: action.pageContextId,
      timestampOffsetMs: action.timestampOffsetMs,
      target: action.target
        ? {
            fingerprint: action.target.fingerprint,
            tag: action.target.tag,
            role: action.target.role,
            accessibleName: action.target.accessibleName,
            associatedLabel: action.target.associatedLabel,
            controlFamily: action.target.descriptor?.controlFamily,
            frame: {
              role: action.target.frame.role,
              origin: action.target.frame.origin,
              pathname: action.target.frame.pathname,
              name: action.target.frame.name,
              title: action.target.frame.title,
            },
          }
        : undefined,
      valueKind: action.value?.kind,
      outputVariable: action.outputVariable,
      editingTransaction: action.editingTransaction
        ? {
            id: action.editingTransaction.id,
            committed: action.editingTransaction.committed,
            inputEvents: action.editingTransaction.inputEvents,
            compositionObserved: action.editingTransaction.compositionObserved,
            pasteObserved: action.editingTransaction.pasteObserved,
          }
        : undefined,
      reactions: action.observedEffects.map((effect) => ({
        type: effect.type,
        pageContextId: effect.pageContextId,
        fingerprint: effect.fingerprint,
      })),
      causedByActionId: action.causedByActionId,
      resultingState: action.resultingState
        ? {
            pageContextId: action.resultingState.pageContextId,
            fingerprint: action.resultingState.fingerprint,
            capturedAt: action.resultingState.capturedAt,
          }
        : undefined,
    }));
    await appendFile(
      trace.filename,
      actionEntries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
      { encoding: "utf8", mode: 0o600 },
    );
    const screenshot = this.testMode ? "after.synthetic.png" : undefined;
    const livePage = this.browser.context
      .pages()
      .find((page) => !page.isClosed());
    if (screenshot && livePage) {
      await livePage.screenshot({
        path: path.join(trace.directory, screenshot),
      });
      await chmod(path.join(trace.directory, screenshot), 0o600);
    }
    await appendFile(
      trace.filename,
      `${JSON.stringify({
        phase: "After",
        traceId: trace.id,
        sessionId: session.id,
        occurredAt: session.stoppedAt,
        structuralSnapshot: session.afterState
          ? {
              pageContextId: session.afterState.pageContextId,
              fingerprint: session.afterState.fingerprint,
              capturedAt: session.afterState.capturedAt,
            }
          : undefined,
        actionCount: session.actions.length,
        pageGraph: session.pageGraph.nodes.map((node) => ({
          id: node.id,
          role: node.role,
          parentId: node.parentId,
          origin: node.origin,
          pathname: node.pathname,
          structuralFingerprint: node.structuralFingerprint,
          status: node.status,
        })),
        screenshot: livePage ? screenshot : undefined,
        syntheticScreenshot: Boolean(screenshot && livePage),
        valuesPersisted: false,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    trace.status = "closed";
  }

  #workflowLibraryIndexPath() {
    return path.join(this.#workflowLibraryDirectory(), "index.json");
  }

  async #writeWorkflowLibraryIndex() {
    const directory = this.#workflowLibraryDirectory();
    await mkdir(directory, { recursive: true });
    const index: WorkflowLibraryIndex = {
      schemaVersion: 1,
      entries: this.workflowLibraryEntries,
    };
    await writeFile(
      this.#workflowLibraryIndexPath(),
      `${JSON.stringify(index, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  async #loadWorkflowLibrary() {
    if (this.#workflowLibraryLoaded) return;
    this.#workflowLibraryLoaded = true;
    this.workflowLibraryEntries.length = 0;
    if (existsSync(this.#workflowLibraryIndexPath())) {
      try {
        const stored = JSON.parse(
          await readFile(this.#workflowLibraryIndexPath(), "utf8"),
        ) as WorkflowLibraryIndex;
        if (stored.schemaVersion === 1 && Array.isArray(stored.entries))
          this.workflowLibraryEntries.push(...stored.entries);
      } catch {
        this.workflowLibraryStatus = "Saved workflow index could not be read.";
      }
    }
    const legacyDirectory = path.join(this.rootDirectory, "compiled-workflows");
    if (existsSync(legacyDirectory)) {
      for (const filename of await readdir(legacyDirectory)) {
        if (!filename.endsWith(".json")) continue;
        try {
          const workflow = CompiledWorkflowSchema.parse(
            JSON.parse(
              await readFile(path.join(legacyDirectory, filename), "utf8"),
            ),
          );
          if (
            this.workflowLibraryEntries.some(
              (entry) => entry.workflowId === workflow.id,
            )
          )
            continue;
          const serialized = JSON.stringify(workflow);
          this.workflowLibraryEntries.push({
            id: `legacy-${workflow.id}`,
            workflowId: workflow.id,
            name: `Legacy ${workflow.id.slice(0, 12)}`,
            version: 1,
            createdAt: workflow.compilationMetadata.compiledAt,
            updatedAt: workflow.compilationMetadata.compiledAt,
            origins: [
              ...new Set(workflow.pageContexts.map((entry) => entry.origin)),
            ],
            pathPatterns: [
              ...new Set(workflow.pageContexts.map((entry) => entry.pathname)),
            ],
            actionCount: workflow.steps.length,
            verification: workflow.expectedOutcome.verification,
            artifactChecksum: sha256(serialized),
            legacy: true,
          });
        } catch {
          // Invalid legacy files are ignored without deleting local artifacts.
        }
      }
    }
    this.workflowLibraryEntries.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
    this.workflowLibraryStatus =
      this.workflowLibraryEntries.length > 0
        ? `${this.workflowLibraryEntries.length} saved workflow version${this.workflowLibraryEntries.length === 1 ? "" : "s"} available.`
        : "No saved workflows yet.";
  }

  #normalizeWorkflowName(value: unknown) {
    if (typeof value !== "string") return "";
    const name = value.replaceAll(/\s+/g, " ").trim();
    if (name.length > 100)
      throw new Error("Workflow name must not exceed 100 characters.");
    if (
      /password|passcode|token|secret|cookie|authorization|api[-_ ]?key/i.test(
        name,
      )
    )
      throw new Error("Workflow name contains a forbidden sensitive term.");
    return name;
  }

  async #saveNamedWorkflow(name: string) {
    if (!this.workflow) return;
    const normalized = name.toLocaleLowerCase();
    const version =
      Math.max(
        0,
        ...this.workflowLibraryEntries
          .filter((entry) => entry.name.toLocaleLowerCase() === normalized)
          .map((entry) => entry.version),
      ) + 1;
    const now = new Date().toISOString();
    const id = createId("saved-workflow");
    const artifactFile = `${id}.json`;
    const bundle = {
      schemaVersion: 1,
      workflow: CompiledWorkflowSchema.parse(this.workflow),
      variables: LocalVariableValuesSchema.parse(this.localValues),
    };
    const serialized = JSON.stringify(bundle);
    const entry: WorkflowLibraryEntry = {
      id,
      workflowId: this.workflow.id,
      name,
      version,
      createdAt: now,
      updatedAt: now,
      origins: [
        ...new Set(this.workflow.pageContexts.map((context) => context.origin)),
      ],
      pathPatterns: [
        ...new Set(
          this.workflow.pageContexts.map((context) => context.pathname),
        ),
      ],
      actionCount: this.workflow.steps.length,
      verification: this.workflow.expectedOutcome.verification,
      artifactChecksum: sha256(serialized),
      artifactFile,
      legacy: false,
    };
    const directory = this.#workflowLibraryDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, artifactFile), `${serialized}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    this.workflowLibraryEntries.unshift(entry);
    this.selectedWorkflowId = entry.id;
    this.workflowLibraryStatus = `Saved locally · ${name} · version ${version}`;
    await this.#writeWorkflowLibraryIndex();
  }

  #readLastDemonstrationMetadata() {
    const filename = path.join(
      this.#lastDemonstrationDirectory(),
      "metadata.json",
    );
    if (!existsSync(filename)) return undefined;
    try {
      const stored = JSON.parse(readFileSync(filename, "utf8")) as Record<
        string,
        unknown
      >;
      const value: LastDemonstrationMetadata =
        stored.version === 1
          ? {
              version: LAST_DEMONSTRATION_VERSION,
              targetOrigin: String(stored.origin ?? ""),
              origin: String(stored.origin ?? ""),
              pathname: String(stored.pathname ?? "/"),
              structuralFingerprint: String(stored.structuralFingerprint ?? ""),
              authenticationPersisted: false,
              queryParametersPersisted: false,
              valuesStoredSeparately: true,
            }
          : (stored as LastDemonstrationMetadata);
      if (
        value.version !== LAST_DEMONSTRATION_VERSION ||
        value.authenticationPersisted !== false ||
        value.queryParametersPersisted !== false ||
        value.valuesStoredSeparately !== true
      )
        return undefined;
      return value;
    } catch {
      return undefined;
    }
  }

  #lastDemonstrationOutcomeStatus() {
    const filename = path.join(
      this.#lastDemonstrationDirectory(),
      "session.json",
    );
    const requiredFields = [
      "applicationStateBefore",
      "applicationStateAfter",
      "outcomeCandidates",
      "effectReconciliation",
    ] as const;
    if (!existsSync(filename))
      return {
        outcomeEvidenceCompatible: false,
        missingOutcomeFields: [...requiredFields],
      };
    try {
      const session = JSON.parse(readFileSync(filename, "utf8")) as Record<
        string,
        unknown
      >;
      const missingOutcomeFields = requiredFields.filter((field) => {
        if (!(field in session)) return true;
        if (field === "outcomeCandidates")
          return (
            !Array.isArray(session[field]) ||
            !(session[field] as unknown[]).some(
              (candidate) =>
                candidate &&
                typeof candidate === "object" &&
                (candidate as { observed?: unknown }).observed === true,
            )
          );
        return !session[field] || typeof session[field] !== "object";
      });
      return {
        outcomeEvidenceCompatible: missingOutcomeFields.length === 0,
        missingOutcomeFields,
      };
    } catch {
      return {
        outcomeEvidenceCompatible: false,
        missingOutcomeFields: [...requiredFields],
      };
    }
  }

  #lastDemonstrationStatus() {
    const metadata = this.#readLastDemonstrationMetadata();
    const directory = this.#lastDemonstrationDirectory();
    const available = Boolean(
      metadata &&
        existsSync(path.join(directory, "session.json")) &&
        existsSync(path.join(directory, "variables.json")),
    );
    let structurallyCompatible = false;
    if (available && this.browser.status().open) {
      const graph = this.browser.graph.data();
      const root = activeMainDocument(graph);
      structurallyCompatible = Boolean(
        root &&
          metadata &&
          metadata.targetOrigin === canonicalizeUrl(this.targetUrl).origin &&
          metadata.origin === root.origin &&
          metadata.pathname === root.pathname &&
          metadata.structuralFingerprint === root.structuralFingerprint,
      );
    }
    return {
      available,
      structurallyCompatible,
      ...this.#lastDemonstrationOutcomeStatus(),
    };
  }

  snapshot() {
    return {
      product: "Visual Compiler 2",
      labMode: true,
      banner: "LAB MODE — local demonstration compiler",
      testMode: this.testMode,
      state: this.machine.state,
      targetUrl: canonicalizeUrl(this.targetUrl).canonicalUrl,
      browser: this.browser.status(),
      recorder: this.recorder?.status() ?? {
        attached: false,
        active: false,
        actionCount: 0,
        passwordEventsExcluded: 0,
        crossOriginEventsExcluded: 0,
        bindingErrors: [],
      },
      session: this.session,
      localRuntimeVariables: this.localValues,
      generalizationInstruction: this.generalizationInstruction,
      aiPayloadPreview: this.aiPayload,
      workflow: this.workflow,
      telemetry: this.telemetry,
      diagnostic: this.compilationDiagnostic,
      compilationDiagnostic: this.compilationDiagnostic,
      studioEventLog: this.studioEventLog,
      lastDemonstration: this.#lastDemonstrationStatus(),
      workflowLibrary: {
        name: this.workflowName,
        selectedId: this.selectedWorkflowId,
        status: this.workflowLibraryStatus,
        entries: this.workflowLibraryEntries,
      },
      teachingTrace: this.#teachingTrace
        ? {
            id: this.#teachingTrace.id,
            sessionId: this.#teachingTrace.sessionId,
            status: this.#teachingTrace.status,
          }
        : undefined,
      metrics: {
        compileTimeModelCalls:
          this.workflow?.compilationMetadata.modelCalls ?? 0,
        runtimeLlmCalls: this.telemetry?.llmCalls ?? 0,
        runtimeOpenAIRequests: this.telemetry?.openAIRequests ?? 0,
      },
      capabilities: {
        animatedRunOptional: true,
        localRunDefaultInLab: true,
        sameRuntimeEngine: true,
        aiCompilationAvailable: Boolean(this.compileProvider),
        aiCompilationProvider:
          this.compileProvider?.mode === "live-gpt-generalization"
            ? "openai"
            : this.compileProvider
              ? "mock"
              : "unavailable",
        compileTimeModel: "gpt-5.6",
        liveGptEnabled:
          this.compileProvider?.mode === "live-gpt-generalization",
      },
    };
  }

  async initialize() {
    await this.#loadWorkflowLibrary();
    if (this.browser.status().open) return this.snapshot();
    try {
      await this.browser.open(this.targetUrl);
      this.recorder = new DemonstrationRecorder(
        this.browser.context,
        this.browser.graph,
      );
      await this.recorder.attach();
      if (this.machine.state !== "IDLE") this.machine.reset();
      this.machine.transition("BROWSER_OPEN");
      this.machine.transition("READY_TO_TEACH");
      await this.persistRecoverableState();
    } catch (error) {
      await this.browser.close().catch(() => undefined);
      this.machine.reset();
      await this.recordDiagnostic(error, undefined, "browser-open");
    }
    return this.snapshot();
  }

  async reopenBrowser() {
    if (
      ["RECORDING", "COMPILING", "RUNNING"].includes(this.machine.state) ||
      this.#mutation
    )
      throw new Error(
        "Stop the active operation before reopening the browser.",
      );
    await this.browser.close();
    this.recorder = undefined;
    this.machine.reset();
    return this.initialize();
  }

  async returnHome() {
    if (!this.browser.status().open)
      throw new Error("Reopen the managed browser before returning home.");
    if (
      ["RECORDING", "COMPILING", "RUNNING"].includes(this.machine.state) ||
      this.#mutation
    )
      throw new Error("Stop the active operation before returning home.");
    await this.browser.navigate(this.targetUrl);
    return this.snapshot();
  }

  async startTeaching() {
    if (
      ![
        "READY_TO_TEACH",
        "DEMONSTRATION_REVIEW",
        "READY_TO_RUN",
        "PASSED",
        "COMPLETED_UNVERIFIED",
        "FAILED",
        "STOPPED",
      ].includes(this.machine.state)
    )
      throw new Error("Studio is not ready to teach.");
    if (!this.recorder || !this.browser.status().open)
      throw new Error("The managed browser is not available.");
    this.machine.transition("RECORDING");
    this.session = await this.recorder!.start();
    await this.#beginTeachingTrace(this.session);
    this.workflow = undefined;
    this.telemetry = undefined;
    this.aiPayload = undefined;
    this.localValues = {};
    await this.persistRecoverableState();
  }

  async clearDemonstration() {
    if (["RECORDING", "COMPILING", "RUNNING"].includes(this.machine.state))
      throw new Error("Stop the active operation before clearing.");
    this.session = undefined;
    this.workflow = undefined;
    this.telemetry = undefined;
    this.aiPayload = undefined;
    this.localValues = {};
    this.generalizationInstruction = "";
    this.machine.reset();
    if (this.browser.status().open) {
      this.machine.transition("BROWSER_OPEN");
      this.machine.transition("READY_TO_TEACH");
    }
    await this.persistRecoverableState();
  }

  async stopTeaching() {
    if (this.machine.state !== "RECORDING")
      throw new Error("Teaching is not active.");
    this.session = await this.recorder!.stop();
    await this.#finishTeachingTrace(this.session);
    this.localValues = LocalVariableValuesSchema.parse(
      this.recorder!.localValues,
    );
    this.machine.transition("DEMONSTRATION_REVIEW");
    await this.persistLastDemonstration();
    await this.persistRecoverableState();
  }

  async persistLastDemonstration() {
    if (!this.session?.stoppedAt)
      throw new Error("Only a completed demonstration can be persisted.");
    const session = DemonstrationSessionSchema.parse(this.session);
    const values = LocalVariableValuesSchema.parse(this.localValues);
    assertNoLocalValuesInSession(session, values);
    const root = demonstratedEntryDocument(session);
    if (!root)
      throw new Error(
        "The completed demonstration has no compatible root structure.",
      );
    const metadata: LastDemonstrationMetadata = {
      version: LAST_DEMONSTRATION_VERSION,
      targetOrigin: canonicalizeUrl(this.targetUrl).origin,
      origin: root.origin,
      pathname: root.pathname,
      structuralFingerprint: root.structuralFingerprint,
      authenticationPersisted: false,
      queryParametersPersisted: false,
      valuesStoredSeparately: true,
    };
    const directory = this.#lastDemonstrationDirectory();
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(directory, "session.json"),
        `${JSON.stringify(session, null, 2)}\n`,
        { mode: 0o600 },
      ),
      writeFile(
        path.join(directory, "variables.json"),
        `${JSON.stringify(values, null, 2)}\n`,
        { mode: 0o600 },
      ),
      writeFile(
        path.join(directory, "metadata.json"),
        `${JSON.stringify(metadata, null, 2)}\n`,
        { mode: 0o600 },
      ),
    ]);
  }

  async restoreLastDemonstration() {
    if (this.machine.state !== "READY_TO_TEACH")
      throw new Error("Open the matching authorized page before restoring.");
    const metadata = this.#readLastDemonstrationMetadata();
    if (!metadata)
      throw new Error("No completed local demonstration is available.");
    const directory = this.#lastDemonstrationDirectory();
    const [sessionText, valuesText] = await Promise.all([
      readFile(path.join(directory, "session.json"), "utf8"),
      readFile(path.join(directory, "variables.json"), "utf8"),
    ]);
    const session = DemonstrationSessionSchema.parse(JSON.parse(sessionText));
    const values = LocalVariableValuesSchema.parse(JSON.parse(valuesText));
    assertNoLocalValuesInSession(session, values);
    const graph = this.browser.graph.data();
    const liveRoot = activeMainDocument(graph);
    if (
      !liveRoot ||
      metadata.targetOrigin !== canonicalizeUrl(this.targetUrl).origin ||
      metadata.origin !== liveRoot.origin ||
      metadata.pathname !== liveRoot.pathname ||
      metadata.structuralFingerprint !== liveRoot.structuralFingerprint
    )
      throw new Error(
        "The last demonstration is structurally incompatible with the current page.",
      );
    this.session = this.recorder!.restore(
      session,
      Object.fromEntries(
        Object.entries(values).map(([name, value]) => [name, String(value)]),
      ),
    );
    this.localValues = values;
    this.workflow = undefined;
    this.telemetry = undefined;
    this.aiPayload = undefined;
    this.generalizationInstruction = "";
    this.machine.transition("DEMONSTRATION_REVIEW");
    await this.persistRecoverableState();
    return this.session;
  }

  updateAction(
    actionId: string,
    patch: { name?: unknown; optional?: unknown; deleted?: unknown },
  ) {
    if (!this.recorder || !this.session)
      throw new Error("No demonstration is available.");
    if (patch.deleted === true) this.recorder.deleteAction(actionId);
    if (typeof patch.name === "string")
      this.recorder.renameAction(actionId, patch.name);
    if (typeof patch.optional === "boolean")
      this.recorder.setActionOptional(actionId, patch.optional);
    this.session = this.recorder.session;
  }

  updateVariable(name: string, privacy: unknown, value: unknown) {
    if (
      !["local-variable", "local-literal", "ai-instruction"].includes(
        String(privacy),
      )
    )
      throw new Error("Invalid variable privacy mode.");
    this.recorder?.setVariablePrivacy(
      name,
      privacy as "local-variable" | "local-literal" | "ai-instruction",
    );
    if (typeof value === "string") this.localValues[name] = value;
    this.session = this.recorder?.session;
  }

  updateOutcomeCandidate(
    candidateId: string,
    patch: { selected?: unknown; required?: unknown },
  ) {
    if (!this.recorder || !this.session)
      throw new Error("No demonstration is available.");
    this.session = this.recorder.updateOutcomeCandidate(candidateId, {
      ...(typeof patch.selected === "boolean"
        ? { selected: patch.selected }
        : {}),
      ...(typeof patch.required === "boolean"
        ? { required: patch.required }
        : {}),
    });
  }

  async reconcileOutcome(useCurrentState = false) {
    if (!this.recorder || !this.session)
      throw new Error("No demonstration is available.");
    if (this.machine.state !== "DEMONSTRATION_REVIEW")
      throw new Error(
        "Application success evidence can only be reconciled during review.",
      );
    this.session = await this.recorder.reconcileCurrentState({
      useCurrentState,
    });
    await this.persistRecoverableState();
    return this.session;
  }

  previewPayload(instruction: unknown) {
    if (!this.session)
      throw new Error("Stop a demonstration before previewing.");
    this.generalizationInstruction =
      typeof instruction === "string" ? instruction : "";
    this.aiPayload = buildAiPayload(
      this.session,
      this.generalizationInstruction,
      this.localValues,
    );
    return this.aiPayload;
  }

  async compile(instruction: unknown, workflowName?: unknown) {
    if (this.#mutation)
      throw new Error(`A ${this.#mutation} request is already active.`);
    if (this.machine.state !== "DEMONSTRATION_REVIEW")
      throw new Error(
        "A reviewed demonstration is required before compilation.",
      );
    if (!this.session) throw new Error("No demonstration is available.");
    this.#mutation = "compile";
    this.compilationDiagnostic = undefined;
    this.machine.transition("COMPILING");
    const previousWorkflow = this.workflow;
    const previousAiPayload = this.aiPayload;
    let stage: StudioCompilationStage = "demonstration-validation";
    try {
      this.generalizationInstruction =
        typeof instruction === "string" ? instruction.trim() : "";
      this.workflowName = this.#normalizeWorkflowName(workflowName);
      if (!this.compileProvider)
        throw new CompilationStageError(
          "generalization",
          new Error(
            "GPT-5.6 compilation is unavailable. Configure OPENAI_API_KEY in the local ignored environment file.",
          ),
        );
      stage = "locator-validation";
      const result = await compileDemonstration({
        session: this.session,
        graph: this.browser.graph,
        localValues: this.localValues,
        generalizationInstruction: this.generalizationInstruction,
        provider: this.compileProvider,
      });
      this.workflow = result.workflow;
      this.aiPayload = result.aiPayload;
      stage = "artifact-persistence";
      await this.persistArtifacts();
      if (this.workflowName) await this.#saveNamedWorkflow(this.workflowName);
      stage = "state-transition";
      this.machine.compileReady();
      this.compilationDiagnostic = undefined;
      await this.persistRecoverableState();
      return this.workflow;
    } catch (error) {
      this.workflow = previousWorkflow;
      this.aiPayload = previousAiPayload;
      this.machine.transition("DEMONSTRATION_REVIEW");
      throw new StudioCompilationFailure(
        error instanceof CompilationStageError ? error.stage : stage,
        error,
      );
    } finally {
      this.#mutation = undefined;
    }
  }

  async recordDiagnostic(
    error: unknown,
    httpStatus: number | undefined,
    explicitStage?:
      | StudioCompilationStage
      | "browser-open"
      | "runtime-execution",
  ) {
    const sensitiveValues = [
      ...Object.values(this.localValues).map(String),
      ...(this.session?.actions.flatMap((action) =>
        action.value?.kind === "literal" ? [action.value.value] : [],
      ) ?? []),
      ...(this.workflow?.steps.flatMap((step) =>
        step.value?.kind === "literal" ? [step.value.value] : [],
      ) ?? []),
      this.generalizationInstruction,
    ];
    const structuralEvidence = findLocatorValidationEvidence(error);
    const structuralAction =
      structuralEvidence && structuralEvidence.actionIndex >= 0
        ? this.session?.actions[structuralEvidence.actionIndex]
        : undefined;
    const applicationOutcomeEvidence =
      findApplicationOutcomeValidationEvidence(error);
    const failedTelemetryStep = this.telemetry?.steps.find(
      (step) => step.status === "failed",
    );
    const compiledStep = failedTelemetryStep
      ? this.workflow?.steps.find(
          (step) => step.id === failedTelemetryStep.stepId,
        )
      : undefined;
    const selectedLocator = compiledStep?.locatorCandidates.find(
      (candidate) => candidate.id === compiledStep.selectedLocatorId,
    );
    const diagnostic: StudioCompilationDiagnostic = {
      id: createId("studio-diagnostic"),
      occurredAt: new Date().toISOString(),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      stage:
        explicitStage ??
        (error instanceof StudioCompilationFailure
          ? error.stage
          : error instanceof CompilationStageError
            ? error.stage
            : "request-validation"),
      workflowState: this.machine.state,
      serverMessage: safeTelemetryMessage(error, sensitiveValues),
      ...(structuralEvidence ? { structuralEvidence } : {}),
      ...(applicationOutcomeEvidence ? { applicationOutcomeEvidence } : {}),
      ...(failedTelemetryStep
        ? { stepId: failedTelemetryStep.stepId }
        : structuralEvidence
          ? { stepId: structuralEvidence.stepId }
          : {}),
      ...(failedTelemetryStep
        ? { actionType: failedTelemetryStep.action }
        : structuralAction
          ? { actionType: structuralAction.action }
          : {}),
      ...((compiledStep?.target ?? structuralAction?.target)
        ? {
            targetSummary: [
              (compiledStep?.target ?? structuralAction?.target)?.role,
              (compiledStep?.target ?? structuralAction?.target)
                ?.accessibleName,
              (compiledStep?.target ?? structuralAction?.target)
                ?.associatedLabel,
              (compiledStep?.target ?? structuralAction?.target)?.tag,
            ]
              .filter(Boolean)
              .join(" · "),
          }
        : {}),
      ...(selectedLocator
        ? { selectedLocator: selectedLocator.selectorPreview }
        : structuralEvidence?.rejectionReasonsByStrategy[0]
          ? {
              selectedLocator: `Rejected ${structuralEvidence.rejectionReasonsByStrategy[0].strategy}: ${structuralEvidence.rejectionReasonsByStrategy[0].selectorPreview}`,
            }
          : {}),
      ...(failedTelemetryStep
        ? { observedReactionSummary: failedTelemetryStep.message }
        : structuralAction?.observedEffects.length
          ? {
              observedReactionSummary: structuralAction.observedEffects
                .map((effect) => effect.type)
                .join(", "),
            }
          : {}),
      ...(this.#teachingTrace
        ? { teachingTraceId: this.#teachingTrace.id }
        : {}),
      llmCalls: 0,
      openAIRequests: 0,
    };
    this.compilationDiagnostic = diagnostic;
    this.studioEventLog.push(diagnostic);
    if (this.studioEventLog.length > 100) this.studioEventLog.shift();
    console.error(`[Studio diagnostic] ${JSON.stringify(diagnostic)}`);
    const directory = path.join(this.rootDirectory, "local-data");
    try {
      await mkdir(directory, { recursive: true });
      await appendFile(
        path.join(directory, "studio-events.jsonl"),
        `${JSON.stringify(diagnostic)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    } catch {
      console.error(
        "[Studio diagnostic] The redacted local event log could not be persisted.",
      );
    }
    return diagnostic;
  }

  recordCompilationDiagnostic(error: unknown, httpStatus: number) {
    return this.recordDiagnostic(error, httpStatus);
  }

  clearCompilationDiagnostic() {
    this.compilationDiagnostic = undefined;
  }

  async resetSyntheticFixture() {
    if (!this.testMode)
      throw new Error(
        "Synthetic fixture reset is available only in automated test mode.",
      );
    if (!this.browser.status().open)
      throw new Error("Open the managed browser before resetting the fixture.");
    if (
      ["RECORDING", "COMPILING", "RUNNING"].includes(this.machine.state) ||
      this.#mutation
    )
      throw new Error(
        "The synthetic fixture cannot be reset while an operation is active.",
      );
    for (const page of this.browser.context.pages()) {
      if (page !== this.browser.mainPage && !page.isClosed())
        await page.close().catch(() => undefined);
    }
    await this.browser.navigate(this.targetUrl);
  }

  async selectWorkflow(value: unknown) {
    await this.#loadWorkflowLibrary();
    if (["RECORDING", "COMPILING", "RUNNING"].includes(this.machine.state))
      throw new Error("Stop the active operation before loading a workflow.");
    if (typeof value !== "string")
      throw new Error("A saved workflow selection is required.");
    const entry = this.workflowLibraryEntries.find(
      (candidate) => candidate.id === value,
    );
    if (!entry) throw new Error("Saved workflow was not found.");
    let workflow: CompiledWorkflow;
    let variables: LocalVariableValues = {};
    if (entry.legacy) {
      workflow = CompiledWorkflowSchema.parse(
        JSON.parse(
          await readFile(
            path.join(
              this.rootDirectory,
              "compiled-workflows",
              `${entry.workflowId}.json`,
            ),
            "utf8",
          ),
        ),
      );
      const legacyVariables = path.join(
        this.rootDirectory,
        "local-data",
        "variables",
        `${entry.workflowId}.json`,
      );
      if (existsSync(legacyVariables))
        variables = LocalVariableValuesSchema.parse(
          JSON.parse(await readFile(legacyVariables, "utf8")),
        );
    } else {
      if (!entry.artifactFile)
        throw new Error("Saved workflow artifact is unavailable.");
      const bundle = JSON.parse(
        await readFile(
          path.join(this.#workflowLibraryDirectory(), entry.artifactFile),
          "utf8",
        ),
      ) as { workflow: unknown; variables?: unknown };
      workflow = CompiledWorkflowSchema.parse(bundle.workflow);
      variables = LocalVariableValuesSchema.parse(bundle.variables ?? {});
    }
    this.workflow = workflow;
    this.localValues = variables;
    this.workflowName = entry.name;
    this.selectedWorkflowId = entry.id;
    this.session = undefined;
    this.telemetry = undefined;
    this.aiPayload = undefined;
    this.machine.reset();
    if (!this.browser.status().open)
      throw new Error("Open the managed browser before loading a workflow.");
    this.machine.transition("BROWSER_OPEN");
    this.machine.transition("READY_TO_TEACH");
    this.machine.transition("READY_TO_RUN");
    this.compilationDiagnostic = undefined;
    this.workflowLibraryStatus = `Loaded · ${entry.name} · version ${entry.version}`;
    await this.persistRecoverableState();
    return workflow;
  }

  async run(mode: unknown) {
    if (this.#mutation)
      throw new Error(`A ${this.#mutation} request is already active.`);
    if (!["local", "animated"].includes(String(mode)))
      throw new Error("Runtime mode must be local or animated.");
    if (!this.workflow)
      throw new Error("Compile a workflow before running it.");
    if (
      ![
        "READY_TO_RUN",
        "PASSED",
        "COMPLETED_UNVERIFIED",
        "FAILED",
        "STOPPED",
      ].includes(this.machine.state)
    )
      throw new Error("Studio is not ready to run.");
    this.#mutation = "run";
    this.machine.transition("RUNNING");
    this.#abortController = new AbortController();
    try {
      const runtime = new DeterministicRuntime({
        context: this.browser.context,
        workflow: CompiledWorkflowSchema.parse(this.workflow),
        variables: LocalVariableValuesSchema.parse(this.localValues),
        mode: mode as "local" | "animated",
        signal: this.#abortController.signal,
        ...(mode === "animated"
          ? { animation: createAnimatedPresentation(380) }
          : {}),
      });
      this.telemetry = await runtime.run();
      this.machine.transition(
        this.telemetry.state === "Passed"
          ? "PASSED"
          : this.telemetry.state === "CompletedUnverified"
            ? "COMPLETED_UNVERIFIED"
            : this.telemetry.state === "Stopped"
              ? "STOPPED"
              : "FAILED",
      );
      if (this.telemetry.state === "Failed") {
        await this.recordDiagnostic(
          this.telemetry.error ?? "Runtime execution failed.",
          422,
          "runtime-execution",
        );
      }
      if (this.selectedWorkflowId) {
        const entry = this.workflowLibraryEntries.find(
          (candidate) => candidate.id === this.selectedWorkflowId,
        );
        if (entry) {
          entry.lastRunStatus = this.telemetry.state;
          entry.lastRunAt = new Date().toISOString();
          entry.updatedAt = entry.lastRunAt;
          this.workflowLibraryStatus = `Last run ${this.telemetry.state.toLowerCase()} · ${entry.name} · version ${entry.version}`;
          await this.#writeWorkflowLibraryIndex();
        }
      }
      if (this.telemetry.state !== "Failed")
        this.compilationDiagnostic = undefined;
      await this.persistRecoverableState();
      return this.telemetry;
    } finally {
      this.#mutation = undefined;
      this.#abortController = undefined;
    }
  }

  async stop() {
    if (this.machine.state === "RUNNING") {
      this.#abortController?.abort();
      return;
    }
    if (this.machine.state === "RECORDING") {
      this.session = await this.recorder!.stop();
      await this.#finishTeachingTrace(this.session);
      this.localValues = this.recorder!.localValues;
      this.machine.transition("STOPPED");
      await this.persistLastDemonstration();
      return;
    }
    throw new Error("Nothing is currently recording or running.");
  }

  async reset() {
    this.#abortController?.abort();
    this.session = undefined;
    this.workflow = undefined;
    this.telemetry = undefined;
    this.aiPayload = undefined;
    this.localValues = {};
    this.generalizationInstruction = "";
    this.workflowName = "";
    this.selectedWorkflowId = undefined;
    this.machine.reset();
    if (this.browser.status().open) {
      this.machine.transition("BROWSER_OPEN");
      this.machine.transition("READY_TO_TEACH");
    }
    await this.persistRecoverableState();
  }

  async persistArtifacts() {
    if (!this.session || !this.workflow) return;
    const demonstrationDirectory = path.join(
      this.rootDirectory,
      "demonstrations",
    );
    const workflowDirectory = path.join(
      this.rootDirectory,
      "compiled-workflows",
    );
    const valuesDirectory = path.join(
      this.rootDirectory,
      "local-data",
      "variables",
    );
    await Promise.all([
      mkdir(demonstrationDirectory, { recursive: true }),
      mkdir(workflowDirectory, { recursive: true }),
      mkdir(valuesDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(demonstrationDirectory, `${this.session.id}.json`),
        `${JSON.stringify(DemonstrationSessionSchema.parse(this.session), null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      ),
      writeFile(
        path.join(workflowDirectory, `${this.workflow.id}.json`),
        `${JSON.stringify(CompiledWorkflowSchema.parse(this.workflow), null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      ),
      writeFile(
        path.join(valuesDirectory, `${this.workflow.id}.json`),
        `${JSON.stringify(LocalVariableValuesSchema.parse(this.localValues), null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      ),
    ]);
  }

  async persistRecoverableState() {
    const directory = path.join(this.rootDirectory, "local-data");
    await mkdir(directory, { recursive: true });
    const value = {
      state: this.machine.state,
      target: canonicalizeUrl(this.targetUrl).canonicalUrl,
      demonstrationId: this.session?.id,
      workflowId: this.workflow?.id,
      updatedAt: new Date().toISOString(),
      authenticationPersisted: false,
      variableValuesPersistedSeparately: true,
    };
    await writeFile(
      path.join(directory, "studio-state.json"),
      `${JSON.stringify(value, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
}

export function createStudioServer(controller = new StudioController()) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/api/health")
        return sendJson(response, 200, { ok: true, localOnly: true });
      if (request.method === "GET" && url.pathname === "/api/state")
        return sendJson(response, 200, redactObject(controller.snapshot()));
      if (request.method === "POST" && url.pathname === "/api/browser/open") {
        await controller.reopenBrowser();
        return sendJson(response, 200, controller.snapshot());
      }
      if (request.method === "POST" && url.pathname === "/api/browser/home") {
        await controller.returnHome();
        return sendJson(response, 200, controller.snapshot());
      }
      if (request.method === "POST" && url.pathname === "/api/fixture/reset") {
        await controller.resetSyntheticFixture();
        return sendJson(response, 200, controller.snapshot());
      }
      if (request.method === "POST" && url.pathname === "/api/teaching/start") {
        await controller.startTeaching();
        return sendJson(response, 200, controller.snapshot());
      }
      if (request.method === "POST" && url.pathname === "/api/teaching/stop") {
        await controller.stopTeaching();
        return sendJson(response, 200, controller.snapshot());
      }
      if (request.method === "POST" && url.pathname === "/api/teaching/clear") {
        await controller.clearDemonstration();
        return sendJson(response, 200, controller.snapshot());
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/teaching/restore-last"
      ) {
        await controller.restoreLastDemonstration();
        return sendJson(response, 200, controller.snapshot());
      }
      if (
        request.method === "PATCH" &&
        url.pathname.startsWith("/api/teaching/actions/")
      ) {
        const actionId = decodeURIComponent(
          url.pathname.slice("/api/teaching/actions/".length),
        );
        controller.updateAction(actionId, await readJson(request));
        return sendJson(response, 200, controller.snapshot());
      }
      if (
        request.method === "PATCH" &&
        url.pathname.startsWith("/api/teaching/outcomes/")
      ) {
        const candidateId = decodeURIComponent(
          url.pathname.slice("/api/teaching/outcomes/".length),
        );
        controller.updateOutcomeCandidate(candidateId, await readJson(request));
        return sendJson(response, 200, controller.snapshot());
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/teaching/reconcile-outcome"
      ) {
        const body = await readJson(request);
        await controller.reconcileOutcome(body.useCurrentState === true);
        return sendJson(response, 200, controller.snapshot());
      }
      if (
        request.method === "PATCH" &&
        url.pathname.startsWith("/api/variables/")
      ) {
        const name = decodeURIComponent(
          url.pathname.slice("/api/variables/".length),
        );
        const body = await readJson(request);
        controller.updateVariable(name, body.privacy, body.value);
        return sendJson(response, 200, controller.snapshot());
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/ai-payload-preview"
      ) {
        const body = await readJson(request);
        return sendJson(
          response,
          200,
          controller.previewPayload(body.instruction),
        );
      }
      if (request.method === "POST" && url.pathname === "/api/compile") {
        const body = await readJson(request);
        await controller.compile(body.instruction, body.workflowName);
        return sendJson(response, 200, controller.snapshot());
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/workflows/select"
      ) {
        const body = await readJson(request);
        await controller.selectWorkflow(body.id);
        return sendJson(response, 200, controller.snapshot());
      }
      if (
        request.method === "POST" &&
        [
          "/api/compilation-diagnostics/clear",
          "/api/diagnostics/clear",
        ].includes(url.pathname)
      ) {
        controller.clearCompilationDiagnostic();
        return sendJson(response, 200, controller.snapshot());
      }
      if (request.method === "POST" && url.pathname === "/api/run") {
        const body = await readJson(request);
        await controller.run(body.mode);
        return sendJson(response, 200, controller.snapshot());
      }
      if (request.method === "POST" && url.pathname === "/api/stop") {
        await controller.stop();
        return sendJson(response, 202, { stopping: true });
      }
      if (request.method === "POST" && url.pathname === "/api/reset") {
        await controller.reset();
        return sendJson(response, 200, controller.snapshot());
      }
      if (request.method === "GET" && url.pathname === "/")
        return await serveFile(response, "index.html");
      if (request.method === "GET" && url.pathname === "/styles.css")
        return await serveFile(response, "styles.css");
      if (request.method === "GET" && url.pathname === "/app.js")
        return await serveFile(response, "app.js");
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const conflict = /already active|not ready|Reset before/.test(message);
      if (url.pathname === "/api/compile") {
        const httpStatus =
          error instanceof StudioCompilationFailure
            ? 422
            : conflict
              ? 409
              : 400;
        const diagnostic = await controller.recordCompilationDiagnostic(
          error,
          httpStatus,
        );
        sendJson(response, httpStatus, {
          error: diagnostic.serverMessage,
          diagnostic,
        });
        return;
      }
      const httpStatus = conflict ? 409 : 400;
      const stage = url.pathname.startsWith("/api/browser/")
        ? "browser-open"
        : url.pathname === "/api/run"
          ? "runtime-execution"
          : "request-validation";
      const diagnostic = await controller.recordDiagnostic(
        error,
        httpStatus,
        stage,
      );
      sendJson(response, httpStatus, {
        error: diagnostic.serverMessage,
        diagnostic,
      });
    }
  });
}

export async function startStudioServer(
  port = Number(process.env.VC_STUDIO_PORT ?? 3100),
  host = process.env.VC_STUDIO_HOST ?? "127.0.0.1",
  options: StudioControllerOptions = {},
) {
  const controller = new StudioController(process.cwd(), options);
  const server = createStudioServer(controller);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  await controller.initialize();
  return { server, controller };
}
