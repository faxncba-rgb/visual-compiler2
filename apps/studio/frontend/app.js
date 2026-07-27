const $ = (selector) => document.querySelector(selector);

let state;
let requestInFlight = false;
let toastTimer;
let lastRunMode = "local";

class ApiError extends Error {
  constructor(message, status, diagnostic) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.diagnostic = diagnostic;
  }
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.className = "visible";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.className = "";
  }, 2800);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? "POST",
    headers: { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(
      body.error ?? `Request failed (${response.status})`,
      response.status,
      body.diagnostic,
    );
  return body;
}

function pretty(value, fallback) {
  return value ? JSON.stringify(value, null, 2) : fallback;
}

function textElement(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

function formatDiagnostic(diagnostic) {
  const lines = [
    `Timestamp: ${diagnostic.occurredAt}`,
    `HTTP status: ${diagnostic.httpStatus ?? "n/a"}`,
    `Stage: ${diagnostic.stage}`,
    `Workflow state: ${diagnostic.workflowState}`,
    `Message: ${diagnostic.serverMessage}`,
    `Runtime LLM calls: ${diagnostic.llmCalls ?? 0}`,
    `Runtime OpenAI requests: ${diagnostic.openAIRequests ?? 0}`,
  ];
  if (diagnostic.stepId) lines.push(`Step ID: ${diagnostic.stepId}`);
  if (diagnostic.actionType)
    lines.push(`Action type: ${diagnostic.actionType}`);
  if (diagnostic.targetSummary)
    lines.push(`Target: ${diagnostic.targetSummary}`);
  if (diagnostic.selectedLocator)
    lines.push(`Selected locator: ${diagnostic.selectedLocator}`);
  if (diagnostic.observedReactionSummary)
    lines.push(`Observed reactions: ${diagnostic.observedReactionSummary}`);
  if (diagnostic.teachingTraceId)
    lines.push(`Teaching trace: ${diagnostic.teachingTraceId}`);
  if (diagnostic.structuralEvidence)
    lines.push(
      `Structural evidence: ${JSON.stringify(diagnostic.structuralEvidence)}`,
    );
  if (diagnostic.applicationOutcomeEvidence)
    lines.push(
      `Outcome evidence: ${JSON.stringify(diagnostic.applicationOutcomeEvidence)}`,
    );
  return lines.join("\n");
}

function renderDiagnostic(diagnostic) {
  const panel = $("#compilationDiagnostics");
  panel.hidden = !diagnostic;
  if (!diagnostic) return;
  $("#diagnosticHttpStatus").textContent =
    diagnostic.httpStatus === undefined ? "—" : String(diagnostic.httpStatus);
  $("#diagnosticCompilerStage").textContent = diagnostic.stage;
  $("#diagnosticWorkflowState").textContent = diagnostic.workflowState;
  $("#diagnosticServerMessage").textContent = diagnostic.serverMessage;
  $("#diagnosticStructuralEvidence").textContent = pretty(
    {
      stepId: diagnostic.stepId,
      actionType: diagnostic.actionType,
      targetSummary: diagnostic.targetSummary,
      selectedLocator: diagnostic.selectedLocator,
      observedReactionSummary: diagnostic.observedReactionSummary,
      teachingTraceId: diagnostic.teachingTraceId,
      structuralEvidence: diagnostic.structuralEvidence,
      applicationOutcomeEvidence: diagnostic.applicationOutcomeEvidence,
      llmCalls: diagnostic.llmCalls,
      openAIRequests: diagnostic.openAIRequests,
    },
    "No additional structural evidence.",
  );
  $("#retryDiagnostic").textContent =
    diagnostic.stage === "browser-open"
      ? "Retry opening browser"
      : diagnostic.stage === "runtime-execution"
        ? "Run again"
        : "Retry compile";
}

function renderGraph(nodes = []) {
  const list = $("#pageGraph");
  list.replaceChildren();
  $("#pageCount").textContent =
    `${nodes.length} context${nodes.length === 1 ? "" : "s"}`;
  if (!nodes.length) {
    list.append(textElement("li", "empty", "No browser contexts yet."));
    return;
  }
  for (const node of nodes) {
    const item = document.createElement("li");
    item.append(
      textElement("strong", "", `${node.role.toUpperCase()} · ${node.status}`),
      textElement("code", "", `${node.origin}${node.pathname}`),
    );
    list.append(item);
  }
}

function renderTimeline(actions = []) {
  const list = $("#timeline");
  list.replaceChildren();
  if (!actions.length) {
    list.append(
      textElement(
        "li",
        "empty",
        state?.state === "RECORDING"
          ? "Teaching is active. Perform the workflow in the managed browser."
          : "No demonstrated actions yet.",
      ),
    );
    return;
  }
  for (const [index, action] of actions.entries()) {
    const item = document.createElement("li");
    const copy = document.createElement("div");
    copy.className = "step-copy";
    const causal = action.causedByActionId ? " · causal reaction" : "";
    const effects = action.observedEffects?.length
      ? ` · ${action.observedEffects.length} reaction${action.observedEffects.length === 1 ? "" : "s"}`
      : "";
    copy.append(
      textElement("strong", "", action.name),
      textElement(
        "span",
        "",
        `${action.action}${action.key ? ` · ${action.key}` : ""} · ${action.timestampOffsetMs} ms${effects}${causal}`,
      ),
    );
    item.append(
      textElement("span", "step-number", String(action.sequence ?? index + 1)),
      copy,
    );
    list.append(item);
  }
}

function renderVariables(variables = [], values = {}) {
  const container = $("#variables");
  container.replaceChildren();
  if (!variables.length) {
    container.append(textElement("p", "empty", "No local variables yet."));
    return;
  }
  for (const variable of variables) {
    const row = document.createElement("div");
    row.className = "variable-row";
    const name = textElement("code", "", `{{${variable.name}}}`);
    if (variable.privacy === "runtime-derived") {
      row.append(
        name,
        textElement("span", "privacy-pill", "Runtime memory only"),
      );
      container.append(row);
      continue;
    }
    const input = document.createElement("input");
    input.value = values?.[variable.name] ?? "";
    input.setAttribute("aria-label", `${variable.name} local value`);
    let inputUpdate;
    input.addEventListener("input", () => {
      clearTimeout(inputUpdate);
      inputUpdate = setTimeout(() => {
        void mutate(
          `/api/variables/${encodeURIComponent(variable.name)}`,
          {
            privacy: variable.privacy,
            value: input.value,
          },
          undefined,
          "PATCH",
        );
      }, 180);
    });
    const privacy = document.createElement("select");
    privacy.setAttribute("aria-label", `${variable.name} privacy`);
    for (const [value, label] of [
      ["local-variable", "Local variable"],
      ["local-literal", "Local literal"],
      ["ai-instruction", "Include intentionally in AI"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = variable.privacy === value;
      privacy.append(option);
    }
    privacy.addEventListener("change", () => {
      void mutate(
        `/api/variables/${encodeURIComponent(variable.name)}`,
        {
          privacy: privacy.value,
          value: input.value,
        },
        undefined,
        "PATCH",
      );
    });
    row.append(name, input, privacy);
    container.append(row);
  }
}

function renderOutcomes(session) {
  const container = $("#outcomeCandidates");
  container.replaceChildren();
  const candidates = session?.outcomeCandidates ?? [];
  if (!candidates.length) {
    container.append(
      textElement("p", "empty", "No positive outcome was derived."),
    );
    return;
  }
  for (const candidate of candidates) {
    const item = document.createElement("div");
    item.className = "outcome-candidate";
    item.append(
      textElement("strong", "", candidate.label),
      textElement(
        "span",
        candidate.observed ? "observed" : "rejected",
        `${candidate.observed ? "Observed" : "Not observed"} · ${Math.round(candidate.confidence * 100)}%`,
      ),
    );
    container.append(item);
  }
}

function renderLocators(workflow) {
  const container = $("#locatorCandidates");
  container.replaceChildren();
  if (!workflow) {
    container.textContent = "No workflow compiled.";
    return;
  }
  for (const step of workflow.steps) {
    const selected = step.locatorCandidates.find(
      (candidate) => candidate.id === step.selectedLocatorId,
    );
    const item = document.createElement("div");
    item.className = "locator-row";
    item.append(
      textElement("strong", "", `${step.action} · ${step.name}`),
      textElement(
        "code",
        "",
        selected?.selectorPreview ?? "No locator required",
      ),
    );
    container.append(item);
  }
}

function renderWorkflowLibrary(library = {}) {
  const name = $("#workflowName");
  if (document.activeElement !== name) name.value = library.name ?? "";
  const select = $("#savedWorkflows");
  const selected = library.selectedId ?? "";
  select.replaceChildren(
    new Option("Select a saved workflow", ""),
    ...(library.entries ?? []).map(
      (entry) =>
        new Option(
          `${entry.name} · v${entry.version}${entry.lastRunStatus ? ` · ${entry.lastRunStatus}` : ""}`,
          entry.id,
        ),
    ),
  );
  select.value = selected;
  $("#workflowLibraryStatus").textContent =
    library.status ?? "No saved workflows yet.";
}

function executableActionCount(session) {
  return (
    session?.actions?.filter(
      (action) =>
        action.target &&
        [
          "click",
          "double-click",
          "fill",
          "select",
          "check",
          "uncheck",
          "keyboard",
          "submit",
          "extract",
        ].includes(action.action),
    ).length ?? 0
  );
}

function compileModeLabel() {
  const capabilities = state?.capabilities;
  if (!capabilities?.aiCompilationAvailable)
    return "GPT-5.6 compilation unavailable — configure OPENAI_API_KEY in .env.local";
  if (capabilities.aiCompilationProvider === "mock")
    return "GPT-5.6 compile-time mock ready — automated tests only";
  return "GPT-5.6 compile-time compilation ready";
}

function renderButtons() {
  const current = state?.state ?? "IDLE";
  const active = ["RECORDING", "COMPILING", "RUNNING"].includes(current);
  const runnable = [
    "READY_TO_RUN",
    "PASSED",
    "COMPLETED_UNVERIFIED",
    "FAILED",
    "STOPPED",
  ].includes(current);
  const teachable = [
    "READY_TO_TEACH",
    "DEMONSTRATION_REVIEW",
    "READY_TO_RUN",
    "PASSED",
    "COMPLETED_UNVERIFIED",
    "FAILED",
    "STOPPED",
  ].includes(current);
  $("#reopenBrowser").disabled = active || requestInFlight;
  $("#returnHome").disabled =
    !state?.browser?.open || active || requestInFlight;
  $("#startTeaching").disabled =
    !teachable || !state?.browser?.open || requestInFlight;
  $("#stopTeaching").disabled = current !== "RECORDING" || requestInFlight;
  $("#clearDemonstration").disabled =
    !state?.session || active || requestInFlight;
  $("#restoreLastDemonstration").disabled =
    current !== "READY_TO_TEACH" ||
    !state?.lastDemonstration?.available ||
    !state?.lastDemonstration?.structurallyCompatible ||
    requestInFlight;
  $("#compile").disabled =
    current !== "DEMONSTRATION_REVIEW" ||
    executableActionCount(state?.session) === 0 ||
    !state?.capabilities?.aiCompilationAvailable ||
    requestInFlight;
  $("#compile").textContent = "Compile";
  $("#localRun").disabled = !state?.workflow || !runnable || requestInFlight;
  $("#animatedRun").disabled = !state?.workflow || !runnable || requestInFlight;
  $("#runAgain").disabled =
    !state?.workflow ||
    !["PASSED", "COMPLETED_UNVERIFIED", "FAILED", "STOPPED"].includes(
      current,
    ) ||
    requestInFlight;
  $("#stopAll").disabled = current !== "RUNNING";
  $("#reset").disabled = current === "RUNNING" || requestInFlight;
}

function render() {
  if (!state) return;
  const diagnostic = state.diagnostic ?? state.compilationDiagnostic;
  $("#studioState").textContent = state.state;
  $("#browserStatus").textContent = state.browser.open ? "OPEN" : "CLOSED";
  $("#recorderStatus").textContent = state.recorder.active
    ? "RECORDING"
    : "OFF";
  $("#compilerStatus").textContent = state.workflow
    ? "SEMANTIC IR"
    : state.state === "COMPILING"
      ? "COMPILING"
      : state.capabilities?.aiCompilationAvailable
        ? "WAITING"
        : "UNAVAILABLE";
  $("#runtimeStatus").textContent = state.telemetry?.state ?? "READY";
  $("#runtimeLlmCalls").textContent = state.metrics.runtimeLlmCalls;
  $("#runtimeOpenAiRequests").textContent = state.metrics.runtimeOpenAIRequests;
  $("#canonicalPage").textContent = state.browser.currentUrl ?? "—";
  $("#browserGuidance").textContent = state.browser.open
    ? "Browser ready. Authenticate and navigate manually; recording is still off."
    : "The dedicated browser is closed. Reopen it to continue.";

  const recording = state.state === "RECORDING";
  $("#recordingIndicator").textContent = recording
    ? "● Teaching now"
    : "Recorder idle";
  $("#recordingIndicator").className =
    "recording-indicator" + (recording ? " active" : "");

  const last = state.lastDemonstration;
  $("#lastDemonstrationStatus").textContent = !last?.available
    ? "No completed local demonstration is available."
    : last.structurallyCompatible
      ? "A compatible local demonstration can be restored."
      : "The stored demonstration does not match the current page structure.";

  const executable = executableActionCount(state.session);
  const verification = state.session?.outcomeVerification ?? "UNVERIFIED";
  $("#demonstrationSummary").textContent = state.session
    ? `${executable} executable action${executable === 1 ? "" : "s"} · outcome ${verification}`
    : "Stop teaching to prepare a demonstration.";
  $("#compileMode").textContent = compileModeLabel();
  $("#runtimeState").textContent = state.telemetry
    ? `${state.telemetry.state} · ${state.telemetry.mode} · ${state.telemetry.steps.length} steps`
    : state.workflow
      ? `Artifact ready · outcome ${state.workflow.expectedOutcome.verification}`
      : "Compile a demonstration to run it.";

  renderTimeline(state.session?.actions ?? []);
  renderGraph(state.session?.pageGraph?.nodes ?? []);
  renderVariables(state.session?.variables ?? [], state.localRuntimeVariables);
  renderWorkflowLibrary(state.workflowLibrary);
  renderOutcomes(state.session);
  renderLocators(state.workflow);
  renderDiagnostic(diagnostic);
  $("#demonstrationJson").textContent = pretty(
    state.session,
    "No demonstration recorded.",
  );
  $("#compiledJson").textContent = pretty(
    state.workflow,
    "No workflow compiled.",
  );
  $("#generatedCode").textContent =
    state.workflow?.compilationMetadata?.generatedPlaywright ??
    "No deterministic outline generated.";
  $("#payloadPreview").textContent = pretty(
    state.aiPayloadPreview,
    "No payload prepared.",
  );
  $("#runtimeLog").textContent = pretty(state.telemetry, "No local run yet.");
  $("#studioEventLog").textContent = state.studioEventLog?.length
    ? state.studioEventLog.map(formatDiagnostic).join("\n\n")
    : "No persistent Studio events yet.";
  renderButtons();
}

function adoptDiagnostic(error) {
  if (!(error instanceof ApiError) || !error.diagnostic) return false;
  if (state) {
    state.diagnostic = error.diagnostic;
    state.compilationDiagnostic = error.diagnostic;
  }
  renderDiagnostic(error.diagnostic);
  renderButtons();
  $("#compilationDiagnostics").scrollIntoView({ block: "nearest" });
  return true;
}

async function refresh() {
  try {
    state = await api("/api/state", { method: "GET" });
    render();
  } catch {
    // A failed refresh must not replace or hide the last persistent diagnostic.
  }
}

async function mutate(path, body, successMessage, method = "POST") {
  requestInFlight = true;
  renderButtons();
  try {
    state = await api(path, { body, method });
    render();
    if (successMessage) toast(successMessage);
    return state;
  } catch (error) {
    adoptDiagnostic(error);
    await refresh();
  } finally {
    requestInFlight = false;
    renderButtons();
  }
}

async function compileWorkflow() {
  requestInFlight = true;
  renderButtons();
  try {
    state = await api("/api/compile", {
      body: {
        instruction: $("#generalizationInstruction").value,
        workflowName: $("#workflowName").value,
      },
    });
    render();
    toast("GPT-5.6 Semantic IR compiled; local artifact ready to run.");
  } catch (error) {
    adoptDiagnostic(error);
    await refresh();
  } finally {
    requestInFlight = false;
    renderButtons();
  }
}

async function run(mode) {
  lastRunMode = mode;
  requestInFlight = true;
  renderButtons();
  try {
    state = await api("/api/run", { body: { mode } });
    render();
    toast(
      `${state.telemetry.state}: LLM calls ${state.metrics.runtimeLlmCalls}, OpenAI requests ${state.metrics.runtimeOpenAIRequests}.`,
    );
  } catch (error) {
    adoptDiagnostic(error);
    await refresh();
  } finally {
    requestInFlight = false;
    renderButtons();
  }
}

$("#reopenBrowser").addEventListener("click", () => {
  void mutate(
    "/api/browser/open",
    {},
    "Managed browser reopened. Authentication remains manual.",
  );
});
$("#returnHome").addEventListener("click", () => {
  void mutate("/api/browser/home", {}, "Returned to the configured home page.");
});
$("#startTeaching").addEventListener("click", () => {
  void mutate("/api/teaching/start", {}, "Teaching started.");
});
$("#stopTeaching").addEventListener("click", () => {
  void mutate(
    "/api/teaching/stop",
    {},
    "Teaching stopped after bounded stable-state reconciliation.",
  );
});
$("#clearDemonstration").addEventListener("click", () => {
  void mutate("/api/teaching/clear", {}, "Current demonstration cleared.");
});
$("#restoreLastDemonstration").addEventListener("click", () => {
  void mutate(
    "/api/teaching/restore-last",
    {},
    "Last compatible local demonstration restored.",
  );
});
$("#compile").addEventListener("click", () => void compileWorkflow());
$("#savedWorkflows").addEventListener("change", () => {
  const id = $("#savedWorkflows").value;
  if (!id) return;
  void mutate(
    "/api/workflows/select",
    { id },
    "Saved workflow loaded and ready to run.",
  );
});
$("#localRun").addEventListener("click", () => void run("local"));
$("#animatedRun").addEventListener("click", () => void run("animated"));
$("#runAgain").addEventListener("click", () => void run(lastRunMode));
$("#stopAll").addEventListener("click", async () => {
  try {
    await api("/api/stop", { body: {} });
    toast("Stop requested.");
    await refresh();
  } catch (error) {
    adoptDiagnostic(error);
  }
});
$("#reset").addEventListener("click", () => {
  void mutate("/api/reset", {}, "Workflow reset. Managed browser kept open.");
});
$("#clearDiagnostics").addEventListener("click", () => {
  void mutate("/api/diagnostics/clear", {}, "Diagnostics cleared.");
});
$("#copyDiagnostics").addEventListener("click", async () => {
  const diagnostic = state?.diagnostic ?? state?.compilationDiagnostic;
  if (!diagnostic) return;
  try {
    await navigator.clipboard.writeText(formatDiagnostic(diagnostic));
    toast("Diagnostics copied.");
  } catch {
    // Clipboard failure leaves the diagnostic visible.
  }
});
$("#retryDiagnostic").addEventListener("click", () => {
  const diagnostic = state?.diagnostic ?? state?.compilationDiagnostic;
  if (!diagnostic) return;
  if (diagnostic.stage === "browser-open") {
    $("#reopenBrowser").click();
  } else if (diagnostic.stage === "runtime-execution") {
    void run(lastRunMode);
  } else {
    void compileWorkflow();
  }
});
$("#generalizationInstruction").addEventListener("input", () => {
  $("#compileMode").textContent = compileModeLabel();
});

await refresh();
setInterval(() => {
  if (!requestInFlight || state?.state === "RUNNING") void refresh();
}, 900);
