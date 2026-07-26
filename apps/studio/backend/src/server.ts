import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ManagedBrowser } from "../../../../packages/managed-browser/src";
import { DemonstrationRecorder } from "../../../../packages/demonstration-recorder/src";
import {
  buildAiPayload,
  compileDemonstration,
  CompilationStageError,
  type CompilationStage,
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
const LAST_DEMONSTRATION_VERSION = 1;

type LastDemonstrationMetadata = {
  version: typeof LAST_DEMONSTRATION_VERSION;
  profileId: string;
  origin: string;
  pathname: string;
  structuralFingerprint: string;
  authenticationPersisted: false;
  queryParametersPersisted: false;
  valuesStoredSeparately: true;
};

function syntheticProfileId(value: string) {
  const url = new URL(value);
  if (url.pathname === "/fixture/popup-workflow")
    return "synthetic-popup-workflow";
  return "synthetic-legacy-dpi";
}

export type StudioCompilationStage =
  | CompilationStage
  | "request-validation"
  | "artifact-persistence"
  | "state-transition";

export type StudioCompilationDiagnostic = {
  id: string;
  occurredAt: string;
  httpStatus: number;
  compilerStage: StudioCompilationStage;
  serverMessage: string;
  structuralEvidence?: LocatorValidationEvidence;
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

function assertSyntheticTarget(value: unknown) {
  if (typeof value !== "string") throw new Error("A target URL is required.");
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== String(process.env.VC_FIXTURE_PORT ?? 4273)
  ) {
    throw new Error(
      "Autonomous Lab Mode is restricted to the bundled local synthetic DPI.",
    );
  }
  return url.toString();
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
  targetUrl = `http://127.0.0.1:${process.env.VC_FIXTURE_PORT ?? 4273}/fixture?variant=A`;
  #abortController: AbortController | undefined;
  #mutation: "compile" | "run" | undefined;

  constructor(private readonly rootDirectory = process.cwd()) {
    this.browser = new ManagedBrowser({
      profileDirectory: path.join(rootDirectory, "browser-profiles", "studio"),
      headless: process.env.VC_HEADLESS === "1",
      slowMo: 0,
    });
  }

  #lastDemonstrationDirectory() {
    return path.join(this.rootDirectory, "local-data", "last-demonstration");
  }

  #readLastDemonstrationMetadata() {
    const filename = path.join(
      this.#lastDemonstrationDirectory(),
      "metadata.json",
    );
    if (!existsSync(filename)) return undefined;
    try {
      const value = JSON.parse(
        readFileSync(filename, "utf8"),
      ) as LastDemonstrationMetadata;
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
      const root = graph.nodes.find((node) => node.id === graph.rootId);
      structurallyCompatible = Boolean(
        root &&
          metadata &&
          metadata.profileId === syntheticProfileId(this.targetUrl) &&
          metadata.origin === root.origin &&
          metadata.pathname === root.pathname &&
          metadata.structuralFingerprint === root.structuralFingerprint,
      );
    }
    return {
      available,
      ...(metadata ? { profileId: metadata.profileId } : {}),
      structurallyCompatible,
    };
  }

  snapshot() {
    return {
      product: "Visual Compiler 2",
      labMode: true,
      banner: "LAB MODE — synthetic test records only",
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
      compilationDiagnostic: this.compilationDiagnostic,
      studioEventLog: this.studioEventLog,
      lastDemonstration: this.#lastDemonstrationStatus(),
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
        liveGptEnabled: false,
      },
    };
  }

  async openBrowser(targetUrl: unknown) {
    if (this.machine.state !== "IDLE")
      throw new Error("Reset before opening a different managed browser.");
    this.targetUrl = assertSyntheticTarget(targetUrl);
    await this.browser.open(this.targetUrl);
    this.recorder = new DemonstrationRecorder(
      this.browser.context,
      this.browser.graph,
    );
    await this.recorder.attach();
    this.machine.transition("BROWSER_OPEN");
    this.machine.transition("AUTHENTICATING");
    await this.persistRecoverableState();
  }

  async authenticationComplete() {
    if (this.machine.state !== "AUTHENTICATING")
      throw new Error("Manual authentication is not currently active.");
    this.machine.transition("READY_TO_TEACH");
    await this.persistRecoverableState();
  }

  async startTeaching() {
    if (
      ![
        "READY_TO_TEACH",
        "DEMONSTRATION_REVIEW",
        "READY_TO_RUN",
        "PASSED",
        "FAILED",
        "STOPPED",
      ].includes(this.machine.state)
    )
      throw new Error("Studio is not ready to teach.");
    this.machine.transition("RECORDING");
    this.session = await this.recorder!.start();
    this.workflow = undefined;
    this.telemetry = undefined;
    this.aiPayload = undefined;
    this.localValues = {};
    await this.persistRecoverableState();
  }

  async stopTeaching() {
    if (this.machine.state !== "RECORDING")
      throw new Error("Teaching is not active.");
    this.session = await this.recorder!.stop();
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
    const root = session.pageGraph.nodes.find(
      (node) => node.id === session.pageGraph.rootId,
    );
    if (!root)
      throw new Error(
        "The completed demonstration has no compatible root structure.",
      );
    const metadata: LastDemonstrationMetadata = {
      version: LAST_DEMONSTRATION_VERSION,
      profileId: syntheticProfileId(this.targetUrl),
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
      throw new Error(
        "Open and authenticate the matching synthetic profile before restoring.",
      );
    const metadata = this.#readLastDemonstrationMetadata();
    if (!metadata)
      throw new Error("No completed synthetic demonstration is available.");
    const directory = this.#lastDemonstrationDirectory();
    const [sessionText, valuesText] = await Promise.all([
      readFile(path.join(directory, "session.json"), "utf8"),
      readFile(path.join(directory, "variables.json"), "utf8"),
    ]);
    const session = DemonstrationSessionSchema.parse(JSON.parse(sessionText));
    const values = LocalVariableValuesSchema.parse(JSON.parse(valuesText));
    assertNoLocalValuesInSession(session, values);
    const graph = this.browser.graph.data();
    const liveRoot = graph.nodes.find((node) => node.id === graph.rootId);
    if (
      !liveRoot ||
      metadata.profileId !== syntheticProfileId(this.targetUrl) ||
      metadata.origin !== liveRoot.origin ||
      metadata.pathname !== liveRoot.pathname ||
      metadata.structuralFingerprint !== liveRoot.structuralFingerprint
    )
      throw new Error(
        "The last demonstration is structurally incompatible with the current synthetic profile.",
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
    this.compilationDiagnostic = undefined;
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

  async compile(instruction: unknown) {
    this.compilationDiagnostic = undefined;
    if (this.#mutation)
      throw new Error(`A ${this.#mutation} request is already active.`);
    if (this.machine.state !== "DEMONSTRATION_REVIEW")
      throw new Error(
        "A reviewed demonstration is required before compilation.",
      );
    if (!this.session) throw new Error("No demonstration is available.");
    this.#mutation = "compile";
    this.machine.transition("COMPILING");
    const previousWorkflow = this.workflow;
    const previousAiPayload = this.aiPayload;
    let stage: StudioCompilationStage = "demonstration-validation";
    try {
      this.generalizationInstruction =
        typeof instruction === "string" ? instruction.trim() : "";
      stage = "locator-validation";
      const result = await compileDemonstration({
        session: this.session,
        graph: this.browser.graph,
        localValues: this.localValues,
        generalizationInstruction: this.generalizationInstruction,
      });
      this.workflow = result.workflow;
      this.aiPayload = result.aiPayload;
      stage = "artifact-persistence";
      await this.persistArtifacts();
      stage = "state-transition";
      this.machine.compileReady();
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

  async recordCompilationDiagnostic(error: unknown, httpStatus: number) {
    const sensitiveValues = [
      ...Object.values(this.localValues).map(String),
      this.generalizationInstruction,
    ];
    const structuralEvidence = findLocatorValidationEvidence(error);
    const diagnostic: StudioCompilationDiagnostic = {
      id: createId("compile-diagnostic"),
      occurredAt: new Date().toISOString(),
      httpStatus,
      compilerStage:
        error instanceof StudioCompilationFailure
          ? error.stage
          : error instanceof CompilationStageError
            ? error.stage
            : "request-validation",
      serverMessage: safeTelemetryMessage(error, sensitiveValues),
      ...(structuralEvidence ? { structuralEvidence } : {}),
    };
    this.compilationDiagnostic = diagnostic;
    this.studioEventLog.push(diagnostic);
    if (this.studioEventLog.length > 100) this.studioEventLog.shift();
    console.error(
      `[Studio compilation diagnostic] ${JSON.stringify(diagnostic)}`,
    );
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
        "[Studio compilation diagnostic] The redacted local event log could not be persisted.",
      );
    }
    return diagnostic;
  }

  clearCompilationDiagnostic() {
    this.compilationDiagnostic = undefined;
  }

  async resetSyntheticFixture() {
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

  async run(mode: unknown) {
    if (this.#mutation)
      throw new Error(`A ${this.#mutation} request is already active.`);
    if (!["local", "animated"].includes(String(mode)))
      throw new Error("Runtime mode must be local or animated.");
    if (!this.workflow)
      throw new Error("Compile a workflow before running it.");
    if (
      !["READY_TO_RUN", "PASSED", "FAILED", "STOPPED"].includes(
        this.machine.state,
      )
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
          : this.telemetry.state === "Stopped"
            ? "STOPPED"
            : "FAILED",
      );
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
      this.localValues = this.recorder!.localValues;
      this.machine.transition("STOPPED");
      await this.persistLastDemonstration();
      return;
    }
    throw new Error("Nothing is currently recording or running.");
  }

  async reset() {
    this.#abortController?.abort();
    await this.browser.close();
    this.recorder = undefined;
    this.session = undefined;
    this.workflow = undefined;
    this.telemetry = undefined;
    this.aiPayload = undefined;
    this.localValues = {};
    this.generalizationInstruction = "";
    this.machine.reset();
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
        const body = await readJson(request);
        await controller.openBrowser(body.targetUrl);
        return sendJson(response, 200, controller.snapshot());
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/browser/authentication-complete"
      ) {
        await controller.authenticationComplete();
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
        await controller.compile(body.instruction);
        return sendJson(response, 200, controller.snapshot());
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/compilation-diagnostics/clear"
      ) {
        controller.clearCompilationDiagnostic();
        return sendJson(response, 200, controller.snapshot());
      }
      if (request.method === "POST" && url.pathname === "/api/run") {
        const body = await readJson(request);
        return sendJson(response, 200, await controller.run(body.mode));
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
      sendJson(response, conflict ? 409 : 400, { error: message });
    }
  });
}

export async function startStudioServer(
  port = Number(process.env.VC_STUDIO_PORT ?? 3100),
  host = process.env.VC_STUDIO_HOST ?? "127.0.0.1",
) {
  const controller = new StudioController();
  const server = createStudioServer(controller);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  return { server, controller };
}
