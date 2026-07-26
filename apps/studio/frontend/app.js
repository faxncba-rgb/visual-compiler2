const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let state;
let toastTimer;
let previewTimer;
let requestInFlight = false;
let lastRunMode = "local";

class ApiError extends Error {
  constructor(message, status, diagnostic) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.diagnostic = diagnostic;
  }
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = error ? "visible error" : "visible";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.className = "";
  }, 3600);
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

function renderGraph(nodes = []) {
  const list = $("#pageGraph");
  list.replaceChildren();
  $("#pageCount").textContent =
    `${nodes.length} context${nodes.length === 1 ? "" : "s"}`;
  if (!nodes.length) {
    list.append(
      textElement(
        "li",
        "empty",
        "Open the managed browser to discover contexts.",
      ),
    );
    return;
  }
  for (const node of nodes) {
    const item = document.createElement("li");
    if (node.parentId) item.style.marginLeft = "16px";
    item.append(
      textElement(
        "strong",
        "",
        `${node.role.toUpperCase()} · ${node.status}${node.sameOriginInspectable ? "" : " · opaque"}`,
      ),
      textElement("code", "", `${node.origin}${node.pathname}`),
    );
    list.append(item);
  }
}

async function patchAction(actionId, patch) {
  try {
    state = await api(`/api/teaching/actions/${encodeURIComponent(actionId)}`, {
      method: "PATCH",
      body: patch,
    });
    render();
  } catch (error) {
    toast(error.message, true);
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
          : "Authenticate, navigate to the synthetic record, then start teaching.",
      ),
    );
    return;
  }
  actions.forEach((action, index) => {
    const item = document.createElement("li");
    const number = textElement("span", "step-number", String(index + 1));
    const copy = document.createElement("div");
    copy.className = "step-copy";
    copy.append(
      textElement(
        "strong",
        "",
        `${action.optional ? "Optional · " : ""}${action.name}`,
      ),
      textElement(
        "span",
        "",
        `${action.action}${action.valueRef ? ` · ${action.valueRef}` : ""}`,
      ),
    );
    const tools = document.createElement("div");
    tools.className = "step-tools";
    const rename = textElement("button", "", "Rename");
    rename.type = "button";
    rename.addEventListener("click", () => {
      const name = prompt("Step name", action.name);
      if (name?.trim()) void patchAction(action.id, { name: name.trim() });
    });
    const optional = textElement(
      "button",
      "",
      action.optional ? "Required" : "Optional",
    );
    optional.type = "button";
    optional.addEventListener(
      "click",
      () => void patchAction(action.id, { optional: !action.optional }),
    );
    const remove = textElement("button", "", "Delete");
    remove.type = "button";
    remove.addEventListener(
      "click",
      () => void patchAction(action.id, { deleted: true }),
    );
    tools.append(rename, optional, remove);
    item.append(number, copy, tools);
    list.append(item);
  });
}

function renderVariables(variables = [], values = {}) {
  const container = $("#variables");
  container.replaceChildren();
  if (!variables.length) {
    container.append(
      textElement("p", "empty", "Typed demonstration values will appear here."),
    );
    return;
  }
  for (const variable of variables) {
    const row = document.createElement("div");
    row.className = "variable-row";
    row.append(textElement("code", "", `{{${variable.name}}}`));
    const input = document.createElement("input");
    input.type = "text";
    input.value = values[variable.name] ?? "";
    input.setAttribute("aria-label", `${variable.name} local value`);
    const privacy = document.createElement("select");
    privacy.setAttribute("aria-label", `${variable.name} privacy`);
    [
      ["local-variable", "Convert to local variable"],
      ["local-literal", "Keep as local literal"],
      ["ai-instruction", "Include in AI intentionally"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = variable.privacy === value;
      privacy.append(option);
    });
    const save = async () => {
      try {
        state = await api(
          `/api/variables/${encodeURIComponent(variable.name)}`,
          {
            method: "PATCH",
            body: { privacy: privacy.value, value: input.value },
          },
        );
        toast(`${variable.name} remains in the selected privacy boundary.`);
        render();
      } catch (error) {
        toast(error.message, true);
      }
    };
    privacy.addEventListener("change", save);
    input.addEventListener("change", save);
    row.append(input, privacy);
    container.append(row);
  }
}

function renderLocators(workflow) {
  const container = $("#locatorCards");
  container.replaceChildren();
  const steps = workflow?.steps ?? [];
  const candidates = steps.flatMap((step) =>
    step.locatorCandidates.map((candidate) => ({ step, candidate })),
  );
  if (!candidates.length) {
    container.append(
      textElement("p", "empty", "Locator candidates appear after compilation."),
    );
    return;
  }
  for (const { step, candidate } of candidates) {
    const card = document.createElement("article");
    card.className =
      "locator-card" +
      (candidate.id === step.selectedLocatorId ? " selected" : "");
    card.append(
      textElement(
        "strong",
        "",
        `${candidate.id === step.selectedLocatorId ? "Selected · " : ""}${candidate.strategy}`,
      ),
      textElement("code", "", candidate.selectorPreview),
      textElement(
        "span",
        "",
        `${step.name} · matches ${candidate.matchCount} · visible ${candidate.visibleCount} · enabled ${candidate.enabledCount} · confidence ${Math.round(candidate.confidence * 100)}%`,
      ),
    );
    container.append(card);
  }
}

function formatCompilationDiagnostic(diagnostic) {
  return [
    `HTTP status: ${diagnostic.httpStatus}`,
    `Compiler stage: ${diagnostic.compilerStage}`,
    `Occurred at: ${diagnostic.occurredAt}`,
    "Redacted server message:",
    diagnostic.serverMessage,
  ].join("\n");
}

function renderCompilationDiagnostics(diagnostic) {
  const panel = $("#compilationDiagnostics");
  panel.hidden = !diagnostic;
  if (!diagnostic) {
    $("#diagnosticHttpStatus").textContent = "—";
    $("#diagnosticCompilerStage").textContent = "—";
    $("#diagnosticServerMessage").textContent = "";
    return;
  }
  $("#diagnosticHttpStatus").textContent = String(diagnostic.httpStatus);
  $("#diagnosticCompilerStage").textContent = diagnostic.compilerStage;
  $("#diagnosticServerMessage").textContent = diagnostic.serverMessage;
}

function renderStudioEventLog(events = []) {
  $("#studioEventLog").textContent = events.length
    ? events.map(formatCompilationDiagnostic).join("\n\n")
    : "No persistent Studio events yet.";
}

function renderButtons() {
  const current = state?.state ?? "IDLE";
  const hasWorkflow = Boolean(state?.workflow);
  $("#openBrowser").disabled = current !== "IDLE";
  $("#authComplete").disabled = current !== "AUTHENTICATING";
  $("#startTeaching").disabled = current !== "READY_TO_TEACH";
  $("#stopTeaching").disabled = current !== "RECORDING";
  $("#rerecord").disabled = ![
    "DEMONSTRATION_REVIEW",
    "READY_TO_RUN",
    "PASSED",
    "FAILED",
    "STOPPED",
  ].includes(current);
  $("#compile").disabled =
    current !== "DEMONSTRATION_REVIEW" || requestInFlight;
  $("#animatedRun").disabled =
    !hasWorkflow ||
    !["READY_TO_RUN", "PASSED", "FAILED", "STOPPED"].includes(current);
  $("#localRun").disabled =
    !hasWorkflow ||
    !["READY_TO_RUN", "PASSED", "FAILED", "STOPPED"].includes(current);
  $("#runAgain").disabled =
    !hasWorkflow || !["PASSED", "FAILED", "STOPPED"].includes(current);
  $("#stopAll").disabled = !["RECORDING", "RUNNING"].includes(current);
  $("#reset").disabled = current === "RUNNING";
}

function render() {
  if (!state) return;
  $("#studioState").textContent = state.state;
  $("#browserStatus").textContent = state.browser.open ? "OPEN" : "CLOSED";
  $("#recorderStatus").textContent = state.recorder.active
    ? "RECORDING"
    : "OFF";
  $("#compilerStatus").textContent = state.workflow
    ? state.workflow.compileMode
    : state.state === "COMPILING"
      ? "COMPILING"
      : "WAITING";
  $("#compileCalls").textContent = state.metrics.compileTimeModelCalls;
  $("#runtimeLlmCalls").textContent = state.metrics.runtimeLlmCalls;
  $("#runtimeOpenAiRequests").textContent = state.metrics.runtimeOpenAIRequests;
  $("#canonicalPage").textContent = state.browser.currentUrl ?? "—";
  const recording = state.state === "RECORDING";
  $("#recordingIndicator").textContent = recording
    ? "● Teaching now"
    : "Recorder idle";
  $("#recordingIndicator").className =
    "recording-indicator" + (recording ? " active" : "");
  $("#runtimeState").textContent = state.telemetry
    ? `${state.telemetry.state} · ${state.telemetry.mode} · ${state.telemetry.steps.length} steps`
    : state.workflow
      ? "Artifact ready · choose either run mode"
      : "Ready when compiled";
  $("#compileMode").textContent = $("#generalizationInstruction").value.trim()
    ? "mocked AI generalization"
    : "direct-demonstration compiler";
  renderGraph(state.session?.pageGraph?.nodes ?? []);
  renderTimeline(state.session?.actions ?? []);
  renderVariables(state.session?.variables ?? [], state.localRuntimeVariables);
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
  $("#runtimeLog").textContent = pretty(state.telemetry, "No local run yet.");
  $("#payloadPreview").textContent = pretty(
    state.aiPayloadPreview,
    "No payload prepared.",
  );
  renderCompilationDiagnostics(state.compilationDiagnostic);
  renderStudioEventLog(state.studioEventLog);
  renderLocators(state.workflow);
  renderButtons();
}

async function refresh() {
  try {
    state = await api("/api/state", { method: "GET" });
    render();
  } catch (error) {
    toast(error.message, true);
  }
}

async function mutate(path, body, successMessage) {
  requestInFlight = true;
  renderButtons();
  try {
    state = await api(path, { body });
    render();
    if (successMessage) toast(successMessage);
    return state;
  } catch (error) {
    toast(error.message, true);
    await refresh();
  } finally {
    requestInFlight = false;
    renderButtons();
  }
}

$("#openBrowser").addEventListener(
  "click",
  () =>
    void mutate(
      "/api/browser/open",
      { targetUrl: $("#targetUrl").value },
      "Managed browser opened. Authentication remains manual and unrecorded.",
    ),
);
$("#authComplete").addEventListener(
  "click",
  () =>
    void mutate(
      "/api/browser/authentication-complete",
      {},
      "Ready to teach on the authorized synthetic record.",
    ),
);
$("#startTeaching").addEventListener(
  "click",
  () => void mutate("/api/teaching/start", {}, "Teaching started."),
);
$("#rerecord").addEventListener(
  "click",
  () => void mutate("/api/teaching/start", {}, "Fresh demonstration started."),
);
$("#stopTeaching").addEventListener(
  "click",
  () =>
    void mutate(
      "/api/teaching/stop",
      {},
      "Teaching stopped. Review the exact recorded timeline.",
    ),
);

async function compileWorkflow() {
  requestInFlight = true;
  if (state) state.compilationDiagnostic = undefined;
  renderCompilationDiagnostics(undefined);
  renderButtons();
  try {
    state = await api("/api/compile", {
      body: { instruction: $("#generalizationInstruction").value },
    });
    render();
    toast(
      "Validated artifact compiled. Animated and local run are both ready.",
    );
  } catch {
    await refresh();
  } finally {
    requestInFlight = false;
    renderButtons();
  }
}

$("#compile").addEventListener("click", () => void compileWorkflow());
$("#clearDiagnostics").addEventListener(
  "click",
  () =>
    void mutate(
      "/api/compilation-diagnostics/clear",
      {},
      "Compilation diagnostics cleared.",
    ),
);
$("#copyDiagnostics").addEventListener("click", async () => {
  const diagnostic = state?.compilationDiagnostic;
  if (!diagnostic) return;
  try {
    await navigator.clipboard.writeText(
      formatCompilationDiagnostic(diagnostic),
    );
    toast("Compilation diagnostics copied.");
  } catch {
    toast("Diagnostics could not be copied.", true);
  }
});

async function run(mode) {
  lastRunMode = mode;
  requestInFlight = true;
  renderButtons();
  toast(
    mode === "local"
      ? "Running the deterministic artifact locally without animation."
      : "Animated presentation is executing the same deterministic artifact.",
  );
  try {
    state = await api("/api/run", { body: { mode } });
    render();
    toast(
      `${state.telemetry.state}: runtime LLM calls ${state.metrics.runtimeLlmCalls}, OpenAI requests ${state.metrics.runtimeOpenAIRequests}.`,
      state.telemetry.state !== "Passed",
    );
  } catch (error) {
    toast(error.message, true);
    await refresh();
  } finally {
    requestInFlight = false;
    renderButtons();
  }
}

$("#animatedRun").addEventListener("click", () => void run("animated"));
$("#localRun").addEventListener("click", () => void run("local"));
$("#runAgain").addEventListener("click", () => void run(lastRunMode));
$("#stopAll").addEventListener("click", async () => {
  try {
    await api("/api/stop", { body: {} });
    toast("Stop requested.");
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
});
$("#reset").addEventListener(
  "click",
  () =>
    void mutate(
      "/api/reset",
      {},
      "Studio reset. Local browser context closed.",
    ),
);

$("#generalizationInstruction").addEventListener("input", () => {
  $("#compileMode").textContent = $("#generalizationInstruction").value.trim()
    ? "mocked AI generalization"
    : "direct-demonstration compiler";
  clearTimeout(previewTimer);
  if (state?.state !== "DEMONSTRATION_REVIEW") return;
  previewTimer = setTimeout(async () => {
    try {
      const preview = await api("/api/ai-payload-preview", {
        body: { instruction: $("#generalizationInstruction").value },
      });
      $("#payloadPreview").textContent = pretty(preview, "");
    } catch (error) {
      $("#payloadPreview").textContent = error.message;
    }
  }, 350);
});

for (const tab of $$(".tab")) {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((candidate) =>
      candidate.classList.toggle("active", candidate === tab),
    );
    $$(".tab-panel").forEach((panel) =>
      panel.classList.toggle("active", panel.dataset.panel === tab.dataset.tab),
    );
  });
}

await refresh();
setInterval(() => {
  if (!requestInFlight || state?.state === "RUNNING") void refresh();
}, 900);
