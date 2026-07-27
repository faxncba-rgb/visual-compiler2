import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import {
  StudioController,
  createStudioServer,
} from "../../apps/studio/backend/src/server";
import { locatorForRule } from "../../packages/locator-engine/src";

const execFileAsync = promisify(execFile);

async function listenOnEphemeralPort(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Studio did not expose a local TCP address.");
  return `http://127.0.0.1:${address.port}`;
}

async function withIsolatedStudio(
  operation: (details: {
    controller: StudioController;
    rootDirectory: string;
    studioOrigin: string;
  }) => Promise<void>,
  targetPath = "/fixture?variant=A",
) {
  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), "visual-compiler-2-studio-e2e-"),
  );
  const previousHeadless = process.env.VC_HEADLESS;
  process.env.VC_HEADLESS = "1";
  const controller = new StudioController(rootDirectory, {
    testMode: true,
    targetUrl: `http://127.0.0.1:${process.env.VC_FIXTURE_PORT ?? "4273"}${targetPath}`,
  });
  const server = createStudioServer(controller);
  try {
    const studioOrigin = await listenOnEphemeralPort(server);
    await controller.initialize();
    await operation({ controller, rootDirectory, studioOrigin });
  } finally {
    if (previousHeadless === undefined) delete process.env.VC_HEADLESS;
    else process.env.VC_HEADLESS = previousHeadless;
    await closeStudioServer(server, controller);
    await rm(rootDirectory, { recursive: true, force: true });
  }
}

test("Studio clearly reports unavailable GPT compilation when no key is configured", async ({
  page,
}) => {
  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), "visual-compiler-2-no-key-e2e-"),
  );
  const controller = new StudioController(rootDirectory, {
    testMode: false,
    targetUrl: "https://example.invalid/",
  });
  const server = createStudioServer(controller);
  try {
    const studioOrigin = await listenOnEphemeralPort(server);
    await page.goto(studioOrigin);
    await expect(page.locator("#compileMode")).toHaveText(
      "GPT-5.6 compilation unavailable — configure OPENAI_API_KEY in .env.local",
    );
    await expect(
      page.getByRole("button", { name: "Compile", exact: true }),
    ).toBeDisabled();
    expect(controller.browser.status().open).toBe(false);
  } finally {
    await closeStudioServer(server, controller);
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("Studio compiles and replays click → c → Enter → Valider through mocked GPT-5.6", async ({
  page,
}) => {
  await withIsolatedStudio(async ({ controller, studioOrigin }) => {
    await page.goto(studioOrigin);
    const initialLibrarySize = controller.workflowLibraryEntries.length;
    await page
      .getByRole("button", { name: "Start teaching", exact: true })
      .click();
    const managedPage = controller.browser.mainPage;
    await managedPage
      .getByRole("button", {
        name: "Choisir une catégorie",
        exact: true,
      })
      .click();
    const listbox = managedPage.getByRole("listbox", {
      name: "Catégories de consultation",
      exact: true,
    });
    await listbox.press("c");
    await listbox.press("Enter");
    await managedPage
      .getByRole("button", { name: "Valider", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Stop teaching", exact: true })
      .click();
    await expect(page.locator("#studioState")).toHaveText(
      "DEMONSTRATION_REVIEW",
      { timeout: 15_000 },
    );

    const demonstrated = controller.session?.actions.filter((action) =>
      ["click", "keyboard"].includes(action.action),
    );
    expect(
      demonstrated?.map((action) =>
        action.action === "keyboard"
          ? `${action.action}:${action.key}`
          : `${action.action}:${action.target?.accessibleName}`,
      ),
    ).toEqual([
      "click:Choisir une catégorie",
      "keyboard:c",
      "keyboard:Enter",
      "click:Valider",
    ]);
    await expect(page.locator("#generalizationInstruction")).toHaveValue("");
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await expect(page.locator("#studioState")).toHaveText("READY_TO_RUN");
    await expect(page.locator("#compilationDiagnostics")).toBeHidden();
    expect(controller.workflow).toMatchObject({
      compileMode: "mock-ai-generalization",
      compilationMetadata: {
        model: "gpt-5.6",
        modelCalls: 1,
      },
    });
    expect(
      controller.workflow?.steps
        .filter((step) => step.action === "keyboard")
        .map((step) => step.key),
    ).toEqual(["c", "Enter"]);

    await controller.browser.navigate(
      `http://127.0.0.1:${process.env.VC_FIXTURE_PORT ?? "4273"}/fixture/keyboard-validation`,
    );
    await page
      .getByRole("button", { name: "Run locally", exact: true })
      .click();
    await expect(page.locator("#studioState")).toHaveText("PASSED");
    expect(controller.telemetry).toMatchObject({
      llmCalls: 0,
      openAIRequests: 0,
    });
    const firstRunId = controller.telemetry?.runId;
    await page.getByRole("button", { name: "Run again", exact: true }).click();
    await expect
      .poll(() => controller.telemetry?.runId, { timeout: 15_000 })
      .not.toBe(firstRunId);
    await expect(page.locator("#studioState")).toHaveText("PASSED");
    expect(controller.telemetry).toMatchObject({
      llmCalls: 0,
      openAIRequests: 0,
    });
    expect(controller.workflowLibraryEntries).toHaveLength(initialLibrarySize);
  }, "/fixture/keyboard-validation");
});

async function closeStudioServer(server: Server, controller: StudioController) {
  await controller.browser.close().catch(() => undefined);
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  await closed;
}

async function teachLegacyLayoutA(
  page: Page,
  controller: StudioController,
  studioOrigin: string,
  demonstratedValue: string,
) {
  await page.goto(studioOrigin);
  await expect(page.locator("#studioState")).toHaveText("READY_TO_TEACH");
  await page
    .getByRole("button", { name: "Start teaching", exact: true })
    .click();
  await expect(page.locator("#studioState")).toHaveText("RECORDING");

  const managedPage = controller.browser.mainPage;
  const initialSchedule = await managedPage.evaluate(() => ({
    date: (
      document.querySelector('[name="date_consultation"]') as HTMLInputElement
    ).value,
    time: (
      document.querySelector('[name="heure_consultation"]') as HTMLInputElement
    ).value,
  }));
  await expect(
    managedPage.locator("[data-vc-consultation-history] > li"),
  ).toHaveCount(0);
  const editor = managedPage
    .frameLocator('iframe[title="Éditeur de consultation"]')
    .getByLabel("Texte de consultation", { exact: true });
  await editor.click();
  await editor.pressSequentially(demonstratedValue);
  await managedPage.waitForTimeout(380);
  await managedPage.getByText("Enregistrer", { exact: true }).click();
  await managedPage
    .getByText("Consultation synthétique enregistrée.", { exact: true })
    .waitFor();
  await expect(
    managedPage.locator("[data-vc-consultation-history] > li"),
  ).toHaveCount(1);
  await expect(
    managedPage
      .frameLocator('iframe[title="Éditeur de consultation"]')
      .getByLabel("Texte de consultation", { exact: true }),
  ).toBeVisible();
  await expect(managedPage.locator('[name="date_consultation"]')).toHaveValue(
    initialSchedule.date,
  );
  await expect(managedPage.locator('[name="heure_consultation"]')).toHaveValue(
    initialSchedule.time,
  );

  await page
    .getByRole("button", { name: "Stop teaching", exact: true })
    .click();
  await expect(page.locator("#studioState")).toHaveText("DEMONSTRATION_REVIEW");
  await expect(page.getByLabel("Instruction", { exact: true })).toHaveValue("");
  return { initialSchedule };
}

test("the recorder remains browser-serializable under the exact tsx dev loader", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "tests/e2e/helpers/dev-mode-recorder-smoke.ts"],
    {
      cwd: path.resolve(import.meta.dirname, "../.."),
      env: {
        ...process.env,
        VC_HEADLESS: "1",
        VC_TEST_MODE: "1",
      },
    },
  );
  expect(stderr).not.toMatch(/ReferenceError|__name|page\.evaluate/);
  expect(JSON.parse(stdout.trim())).toEqual({
    fillCount: 1,
    fillValue: {
      kind: "literal",
      value: "SYNTHETIC-DEV-MODE-CALLBACK",
      persistence: "workflow",
    },
    stable: "stable",
    historyCount: 1,
    saveLinkedToFill: true,
    hostFormName: "consultation-record",
  });
});

test("Legacy DPI layout A survives same-path editor rerender, compiles and runs through Studio controls", async ({
  page,
}) => {
  await withIsolatedStudio(async ({ controller, studioOrigin }) => {
    const demonstratedValue = "SYNTHETIC-LEGACY-LAYOUT-A";
    const { initialSchedule } = await teachLegacyLayoutA(
      page,
      controller,
      studioOrigin,
      demonstratedValue,
    );
    await expect(page.locator("#demonstrationSummary")).toContainText(
      "outcome VERIFIED",
    );
    expect(controller.session?.outcomeVerification).toBe("VERIFIED");
    expect(controller.session?.effectReconciliation).toMatchObject({
      status: "stable",
      popupOpened: true,
      popupClosed: true,
      frameReplacementObserved: true,
      pageContextReturned: true,
      editorResetObserved: true,
    });
    expect(
      controller.session?.actions.map((action) => action.sequence),
    ).toEqual(controller.session?.actions.map((_, index) => index + 1));
    expect(
      controller.session?.actions.find((action) => action.action === "fill")
        ?.value,
    ).toEqual({
      kind: "literal",
      value: demonstratedValue,
      persistence: "workflow",
    });
    expect(
      controller.session?.outcomeCandidates.filter(
        (candidate) => candidate.selected,
      ),
    ).toEqual([
      expect.objectContaining({
        type: "relative-count-increase",
        required: true,
      }),
    ]);
    expect(JSON.stringify(controller.session)).toContain(demonstratedValue);

    await page.getByRole("button", { name: "Compile", exact: true }).click();

    await expect(page.locator("#studioState")).toHaveText("READY_TO_RUN");
    await expect(page.locator("#toast")).toHaveText(
      "GPT-5.6 Semantic IR compiled; local artifact ready to run.",
    );
    await expect(page.locator("#toast")).not.toHaveClass(/error/);
    await expect(page.locator("#compilationDiagnostics")).toBeHidden();
    expect(controller.workflow?.compileMode).toBe("mock-ai-generalization");
    expect(controller.workflow?.compilationMetadata.modelCalls).toBe(1);
    expect(controller.workflow?.expectedOutcome).toMatchObject({
      verification: "VERIFIED",
      requireAllPositive: true,
      positiveEvidence: [
        {
          type: "relative-count-increase",
          target: "[data-vc-consultation-history] > li",
          expected: 1,
          required: true,
          pageContextId: expect.any(String),
        },
      ],
    });
    expect(
      controller.workflow?.steps.find((step) => step.action === "fill")?.target
        ?.associatedLabel,
    ).toBe("Texte de consultation");
    const fillStep = controller.workflow?.steps.find(
      (step) => step.action === "fill",
    );
    expect(
      controller.workflow?.steps.filter((step) => step.action === "fill"),
    ).toHaveLength(1);
    const selected = fillStep?.locatorCandidates.find(
      (candidate) => candidate.id === fillStep.selectedLocatorId,
    );
    expect(fillStep?.target?.descriptor).toMatchObject({
      controlFamily: "multiline-text",
      actionCompatibility: ["fill"],
      multiline: true,
      editable: true,
      hostFormName: "consultation-record",
      semanticContainer: {
        heading: "Consultation",
      },
      precedingLabels: expect.arrayContaining(["Date", "Heure"]),
      relatedActionName: "Enregistrer",
      frame: {
        role: "same-origin",
        pathname: "/fixture/editor-frame",
      },
    });
    expect(selected).toBeDefined();
    const resolution = await controller.browser.graph.resolveLiveTargetRoot(
      fillStep!.pageContextId,
      fillStep!.target!.descriptor!.frame,
    );
    expect(resolution.originalDomNodeReplaced).toBe(true);
    expect(resolution.semanticEquivalentFound).toBe(true);
    expect(await locatorForRule(resolution.root!, selected!.rule).count()).toBe(
      1,
    );
    expect(
      await locatorForRule(resolution.root!, selected!.rule).evaluate(
        (element) => ({
          tag: element.tagName.toLowerCase(),
          field: element.getAttribute("data-vc-field"),
        }),
      ),
    ).toEqual({ tag: "textarea", field: "consultation" });
    expect(JSON.stringify(selected!.rule)).not.toMatch(
      /Date|Heure|date_consultation|heure_consultation/,
    );
    const saveStep = controller.workflow?.steps.find(
      (step) =>
        step.action === "click" &&
        step.target?.descriptor?.normalizedStaticText === "Enregistrer",
    );
    const selectedSaveLocator = saveStep?.locatorCandidates.find(
      (candidate) => candidate.id === saveStep.selectedLocatorId,
    );
    expect(saveStep?.target).toMatchObject({
      tag: "a",
      role: "link",
      accessibleName: "Enregistrer",
      descriptor: {
        controlFamily: "link",
        normalizedStaticText: "Enregistrer",
        hasOnclick: true,
        rawTargetPromoted: true,
      },
    });
    expect(saveStep?.sequenceContext).toMatchObject({
      previousAction: "fill",
      demonstratedAfterPrevious: true,
      sameForm: true,
      sameSemanticContainer: true,
      savesPreviousEditor: true,
    });
    const saveAction = controller.session?.actions.find(
      (action) => action.id === saveStep?.sourceActionId,
    );
    expect(saveAction?.resultingState).toMatchObject({
      pageContextId: expect.any(String),
      fingerprint: expect.any(String),
    });
    expect(
      controller.session?.actions
        .filter((action) =>
          ["popup-open", "popup-close", "navigation"].includes(action.action),
        )
        .every((action) => action.causedByActionId === saveAction?.id),
    ).toBe(true);
    expect(selectedSaveLocator).toMatchObject({
      matchCount: 1,
      visibleCount: 1,
      enabledCount: 1,
      typeCompatibleCount: 1,
      rule: {
        strategy: "role-name",
        role: "link",
        name: "Enregistrer",
      },
    });
    expect(
      await locatorForRule(
        controller.browser.mainPage,
        selectedSaveLocator!.rule,
      ).evaluate((element) => element.tagName.toLowerCase()),
    ).toBe("a");
    expect(JSON.stringify(controller.workflow)).toContain(demonstratedValue);
    await page.locator("#advancedDetails > summary").click();
    await expect(
      page.getByLabel("consultation_text local value", { exact: true }),
    ).toHaveCount(0);
    expect(controller.localValues).toEqual({});

    const saveCountBeforeRun = Number(
      await controller.browser.mainPage
        .locator("[data-vc-save-count]")
        .innerText(),
    );
    await page
      .getByRole("button", { name: "Run locally", exact: true })
      .click();
    await expect(page.locator("#studioState")).toHaveText("PASSED");
    await expect(page.locator("#toast.error")).toBeHidden();
    await expect(
      controller.browser.mainPage
        .frameLocator('iframe[title="Éditeur de consultation"]')
        .getByLabel("Texte de consultation", { exact: true }),
    ).toHaveValue("");
    await expect(
      controller.browser.mainPage.locator('[name="date_consultation"]'),
    ).toHaveValue(initialSchedule.date);
    await expect(
      controller.browser.mainPage.locator('[name="heure_consultation"]'),
    ).toHaveValue(initialSchedule.time);
    await expect(
      controller.browser.mainPage.locator("[data-vc-save-count]"),
    ).toHaveText(String(saveCountBeforeRun + 1));
    await expect(
      controller.browser.mainPage.locator(
        "[data-vc-consultation-history] > li",
      ),
    ).toHaveCount(2);
    await expect(
      controller.browser.mainPage
        .locator("[data-vc-consultation-history] > li")
        .last(),
    ).toContainText(demonstratedValue);
    expect(controller.telemetry).toMatchObject({
      state: "Passed",
      llmCalls: 0,
      openAIRequests: 0,
    });
    await page.getByRole("button", { name: "Run again", exact: true }).click();
    await expect(page.locator("#studioState")).toHaveText("PASSED");
    await expect(page.locator("#toast.error")).toBeHidden();
    await expect(
      controller.browser.mainPage.locator(
        "[data-vc-consultation-history] > li",
      ),
    ).toHaveCount(3);
    await expect(
      controller.browser.mainPage.locator("[data-vc-save-count]"),
    ).toHaveText(String(saveCountBeforeRun + 2));
    await expect(
      controller.browser.mainPage.locator('[name="date_consultation"]'),
    ).toHaveValue(initialSchedule.date);
    await expect(
      controller.browser.mainPage.locator('[name="heure_consultation"]'),
    ).toHaveValue(initialSchedule.time);

    await controller.resetSyntheticFixture();
    await expect(
      controller.browser.mainPage.locator(
        "[data-vc-consultation-history] > li",
      ),
    ).toHaveCount(0);
    expect(controller.workflow).toBeDefined();
    await expect(
      page.getByRole("button", { name: "Run again", exact: true }),
    ).toBeEnabled();
  });
});

test("Workflow Library auto-saves immutable versions, reloads after restart and reads legacy artifacts", async ({
  page,
}) => {
  await withIsolatedStudio(
    async ({ controller, rootDirectory, studioOrigin }) => {
      const workflowName = "Synthetic consultation workflow";
      const firstValue = "SYNTHETIC-LIBRARY-LITERAL-V1";
      await teachLegacyLayoutA(page, controller, studioOrigin, firstValue);
      await page
        .getByLabel("Workflow name", { exact: true })
        .fill(workflowName);
      await page.getByRole("button", { name: "Compile", exact: true }).click();
      await expect(page.locator("#studioState")).toHaveText("READY_TO_RUN");
      await expect(
        page.getByLabel("Saved workflows", { exact: true }),
      ).toContainText(`${workflowName} · v1`);
      const versionOne = controller.workflowLibraryEntries.find(
        (entry) => entry.name === workflowName && entry.version === 1,
      );
      expect(versionOne?.legacy).toBe(false);
      const versionOneArtifact = await readFile(
        path.join(
          rootDirectory,
          "local-data",
          "workflow-library",
          versionOne!.artifactFile!,
        ),
        "utf8",
      );
      expect(versionOneArtifact).toContain(firstValue);

      await controller.resetSyntheticFixture();
      await controller.startTeaching();
      const secondValue = "SYNTHETIC-LIBRARY-LITERAL-V2";
      const managedPage = controller.browser.mainPage;
      const editor = managedPage
        .frameLocator('iframe[title="Éditeur de consultation"]')
        .getByLabel("Texte de consultation", { exact: true });
      await editor.fill(secondValue);
      await managedPage.getByText("Enregistrer", { exact: true }).click();
      await managedPage
        .getByText("Consultation synthétique enregistrée.")
        .waitFor();
      await controller.stopTeaching();
      await controller.compile("", workflowName);

      const versions = controller.workflowLibraryEntries
        .filter((entry) => entry.name === workflowName)
        .map((entry) => entry.version)
        .sort();
      expect(versions).toEqual([1, 2]);
      expect(versionOneArtifact).toBe(
        await readFile(
          path.join(
            rootDirectory,
            "local-data",
            "workflow-library",
            versionOne!.artifactFile!,
          ),
          "utf8",
        ),
      );

      const legacyWorkflow = {
        ...structuredClone(controller.workflow!),
        id: "workflow-legacy-compatible",
      };
      await writeFile(
        path.join(
          rootDirectory,
          "compiled-workflows",
          "workflow-legacy-compatible.json",
        ),
        `${JSON.stringify(legacyWorkflow, null, 2)}\n`,
      );
      await controller.browser.close();

      const restarted = new StudioController(rootDirectory, {
        testMode: true,
        targetUrl: `http://127.0.0.1:${process.env.VC_FIXTURE_PORT ?? "4273"}/fixture?variant=A`,
      });
      const restartedServer = createStudioServer(restarted);
      try {
        await listenOnEphemeralPort(restartedServer);
        await restarted.initialize();
        expect(
          restarted.workflowLibraryEntries.some(
            (entry) => entry.workflowId === "workflow-legacy-compatible",
          ),
        ).toBe(true);
        const restoredVersionOne = restarted.workflowLibraryEntries.find(
          (entry) => entry.name === workflowName && entry.version === 1,
        )!;
        await restarted.selectWorkflow(restoredVersionOne.id);
        expect(JSON.stringify(restarted.workflow)).toContain(firstValue);
        const telemetry = await restarted.run("local");
        expect(telemetry.state, telemetry.error).toBe("Passed");
        expect(telemetry.llmCalls).toBe(0);
        expect(telemetry.openAIRequests).toBe(0);
        expect(restoredVersionOne.lastRunStatus).toBe("Passed");
      } finally {
        await closeStudioServer(restartedServer, restarted);
      }
    },
  );
});

test("Teaching trace is automatic, structural and referenced by persistent missing-action diagnostics", async ({
  page,
}) => {
  await withIsolatedStudio(
    async ({ controller, rootDirectory, studioOrigin }) => {
      const literal = "SYNTHETIC-TRACE-MUST-NOT-PERSIST-VALUE";
      await teachLegacyLayoutA(page, controller, studioOrigin, literal);
      const firstTrace = controller.snapshot().teachingTrace!;
      const firstTraceDirectory = path.join(
        rootDirectory,
        "local-data",
        "teaching-traces",
        firstTrace.id,
      );
      const traceText = await readFile(
        path.join(firstTraceDirectory, "trace.jsonl"),
        "utf8",
      );
      expect(traceText).toContain('"phase":"Before"');
      expect(traceText).toContain('"phase":"Action"');
      expect(traceText).toContain('"phase":"After"');
      expect(traceText).toContain('"valueKind":"literal"');
      expect(traceText).not.toContain(literal);
      expect(traceText).not.toMatch(
        /password|cookie|authorization|api[-_]?key|[?&]patient=/i,
      );
      expect(
        await readFile(path.join(firstTraceDirectory, "before.synthetic.png")),
      ).not.toHaveLength(0);

      await controller.clearDemonstration();
      await controller.startTeaching();
      await controller.stopTeaching();
      const emptyTraceId = controller.snapshot().teachingTrace!.id;
      const response = await page.request.post(`${studioOrigin}/api/compile`, {
        data: { instruction: "", workflowName: "" },
      });
      expect(response.status()).toBe(422);
      const body = await response.json();
      expect(body.diagnostic.teachingTraceId).toBe(emptyTraceId);
      await page.reload();
      await expect(page.locator("#compilationDiagnostics")).toBeVisible();
      await expect(page.locator("#diagnosticHttpStatus")).toHaveText("422");
      await expect(page.locator("#diagnosticStructuralEvidence")).toContainText(
        emptyTraceId,
      );
    },
  );
});

test("fill without Enregistrer compiles and runs as COMPLETED_UNVERIFIED", async ({
  page,
}) => {
  await withIsolatedStudio(async ({ controller, studioOrigin }) => {
    await page.goto(studioOrigin);
    await page
      .getByRole("button", { name: "Start teaching", exact: true })
      .click();
    const editor = controller.browser.mainPage
      .frameLocator('iframe[title="Éditeur de consultation"]')
      .getByLabel("Texte de consultation", { exact: true });
    await editor.fill("SYNTHETIC-NO-SAVE-OUTCOME");
    await controller.browser.mainPage.waitForTimeout(380);
    await page
      .getByRole("button", { name: "Stop teaching", exact: true })
      .click();
    await expect(page.locator("#studioState")).toHaveText(
      "DEMONSTRATION_REVIEW",
    );
    expect(controller.session?.outcomeVerification).toBe("UNVERIFIED");
    await expect(
      page.getByRole("button", { name: "Compile", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await expect(page.locator("#studioState")).toHaveText("READY_TO_RUN");
    expect(controller.workflow?.expectedOutcome).toMatchObject({
      positiveEvidence: [],
      requireAllPositive: false,
      verification: "UNVERIFIED",
    });
    await page
      .getByRole("button", { name: "Run locally", exact: true })
      .click();
    await expect(page.locator("#studioState")).toHaveText(
      "COMPLETED_UNVERIFIED",
    );
    expect(controller.telemetry).toMatchObject({
      state: "CompletedUnverified",
      llmCalls: 0,
      openAIRequests: 0,
    });
  });
});

test("popup completion without a relative history increment fails Run locally", async ({
  page,
}) => {
  await withIsolatedStudio(async ({ controller, studioOrigin }) => {
    await teachLegacyLayoutA(
      page,
      controller,
      studioOrigin,
      "SYNTHETIC-RUNTIME-HISTORY-GUARD",
    );
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await expect(page.locator("#studioState")).toHaveText("READY_TO_RUN");
    await controller.browser.navigate(
      `http://127.0.0.1:${process.env.VC_FIXTURE_PORT ?? "4273"}/fixture?variant=B&noHistory=1`,
    );
    await page
      .getByRole("button", { name: "Run locally", exact: true })
      .click();
    await expect(page.locator("#studioState")).toHaveText("FAILED");
    await expect(
      controller.browser.mainPage.locator("[data-vc-save-count]"),
    ).toHaveText("1");
    await expect(
      controller.browser.mainPage.locator(
        "[data-vc-consultation-history] > li",
      ),
    ).toHaveCount(0);
    expect(
      controller.browser.context
        .pages()
        .filter((candidate) => !candidate.isClosed()),
    ).toEqual([controller.browser.mainPage]);
    expect(controller.telemetry).toMatchObject({
      state: "Failed",
      llmCalls: 0,
      openAIRequests: 0,
    });
    expect(controller.telemetry?.error).toContain(
      "Required positive outcome missing: relative-count-increase",
    );
  });
});

test("Stop teaching reconciles popup, rerender and history effects that arrive after the click", async ({
  page,
}) => {
  await withIsolatedStudio(async ({ controller, studioOrigin }) => {
    await page.goto(studioOrigin);
    await page
      .getByRole("button", { name: "Start teaching", exact: true })
      .click();
    const editor = controller.browser.mainPage
      .frameLocator('iframe[title="Éditeur de consultation"]')
      .getByLabel("Texte de consultation", { exact: true });
    await editor.fill("SYNTHETIC-LATE-OUTCOME");
    await controller.browser.mainPage.waitForTimeout(380);
    await controller.browser.mainPage
      .getByText("Enregistrer", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Stop teaching", exact: true })
      .click();
    await expect(page.locator("#studioState")).toHaveText(
      "DEMONSTRATION_REVIEW",
    );
    expect(controller.session?.applicationStateAfter?.historyCount).toBe(1);
    expect(controller.session?.effectReconciliation).toMatchObject({
      status: "stable",
      popupOpened: true,
      popupClosed: true,
      frameReplacementObserved: true,
      editorResetObserved: true,
    });
    expect(controller.session?.outcomeCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "relative-count-increase",
          observed: true,
          selected: true,
        }),
      ]),
    );
  });
});

test("capture-time locator evidence is not invalidated by a later duplicate DOM node", async ({
  page,
}) => {
  await withIsolatedStudio(async ({ controller, studioOrigin }) => {
    await teachLegacyLayoutA(
      page,
      controller,
      studioOrigin,
      "SYNTHETIC-RETRY-VALUE",
    );
    const sessionId = controller.session?.id;
    const demonstratedActionCount = controller.session?.actions.length;
    const liveEditorFrame = controller.browser.mainPage
      .frames()
      .find((frame) => frame.url().endsWith("/fixture/editor-frame"));
    expect(liveEditorFrame).toBeDefined();
    await liveEditorFrame!.evaluate(() => {
      const original = document.querySelector(
        '[data-vc-field="consultation"]',
      ) as HTMLTextAreaElement;
      const originalLabel = document.querySelector(
        `label[for="${original.id}"]`,
      ) as HTMLLabelElement;
      const duplicateLabel = originalLabel.cloneNode(true) as HTMLLabelElement;
      const duplicate = original.cloneNode(true) as HTMLTextAreaElement;
      duplicate.id = `${original.id}-duplicate`;
      duplicate.dataset.vcDuplicate = "true";
      duplicateLabel.htmlFor = duplicate.id;
      duplicateLabel.dataset.vcDuplicate = "true";
      document.body.append(duplicateLabel, duplicate);
    });

    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await expect(page.locator("#studioState")).toHaveText("READY_TO_RUN");
    await expect(page.locator("#compilationDiagnostics")).toBeHidden();
    expect(controller.session?.id).toBe(sessionId);
    expect(controller.session?.actions.length).toBe(demonstratedActionCount);
    expect(controller.generalizationInstruction).toBe("");
    expect(controller.workflow?.compileMode).toBe("mock-ai-generalization");
  });
});

test("the last completed synthetic demonstration restores after a Studio restart only on a compatible page", async ({
  page,
}) => {
  await withIsolatedStudio(
    async ({ controller, rootDirectory, studioOrigin }) => {
      const demonstratedValue = "SYNTHETIC-RESTORED-DEMONSTRATION";
      const original = await teachLegacyLayoutA(
        page,
        controller,
        studioOrigin,
        demonstratedValue,
      );
      const persistedDirectory = path.join(
        rootDirectory,
        "local-data",
        "last-demonstration",
      );
      const [sessionText, variablesText, metadataText] = await Promise.all([
        readFile(path.join(persistedDirectory, "session.json"), "utf8"),
        readFile(path.join(persistedDirectory, "variables.json"), "utf8"),
        readFile(path.join(persistedDirectory, "metadata.json"), "utf8"),
      ]);
      expect(sessionText).toContain(demonstratedValue);
      expect(metadataText).not.toContain(demonstratedValue);
      expect(metadataText).not.toContain("?variant=");
      expect(metadataText).not.toMatch(
        /cookie|token|authorization|authenticationState/i,
      );
      expect(JSON.parse(variablesText)).toEqual({});
      expect(controller.snapshot().lastDemonstration).toMatchObject({
        available: true,
        outcomeEvidenceCompatible: true,
        missingOutcomeFields: [],
      });
      await controller.browser.close();

      const incompatibleController = new StudioController(rootDirectory, {
        testMode: true,
        targetUrl: `http://127.0.0.1:${process.env.VC_FIXTURE_PORT ?? "4273"}/fixture?variant=B`,
      });
      const incompatibleServer = createStudioServer(incompatibleController);
      try {
        const incompatibleOrigin =
          await listenOnEphemeralPort(incompatibleServer);
        await incompatibleController.initialize();
        await page.goto(incompatibleOrigin);
        await expect(
          page.getByRole("button", {
            name: "Restore last demonstration",
            exact: true,
          }),
        ).toBeDisabled();
        await expect(page.locator("#lastDemonstrationStatus")).toContainText(
          "does not match the current page structure",
        );
      } finally {
        await closeStudioServer(incompatibleServer, incompatibleController);
      }

      const restoredController = new StudioController(rootDirectory, {
        testMode: true,
        targetUrl: `http://127.0.0.1:${process.env.VC_FIXTURE_PORT ?? "4273"}/fixture?variant=A`,
      });
      const restoredServer = createStudioServer(restoredController);
      try {
        const restoredOrigin = await listenOnEphemeralPort(restoredServer);
        await restoredController.initialize();
        await page.goto(restoredOrigin);
        const restore = page.getByRole("button", {
          name: "Restore last demonstration",
          exact: true,
        });
        await expect(restore).toBeEnabled();
        await expect(page.locator("#lastDemonstrationStatus")).toContainText(
          "compatible local demonstration",
        );
        await restore.click();
        await expect(page.locator("#studioState")).toHaveText(
          "DEMONSTRATION_REVIEW",
        );
        expect(restoredController.session?.id).toBe(controller.session?.id);
        expect(restoredController.localValues).toEqual(controller.localValues);
        await page
          .getByRole("button", { name: "Compile", exact: true })
          .click();
        await expect(page.locator("#studioState")).toHaveText("READY_TO_RUN");
        expect(restoredController.workflow).toBeDefined();
        expect(original.initialSchedule).toEqual({
          date: "26/07/2026",
          time: "14:30",
        });
      } finally {
        await closeStudioServer(restoredServer, restoredController);
      }
    },
  );
});

test("compile failures remain redacted, persistent, copyable and locally logged", async ({
  page,
}) => {
  await withIsolatedStudio(
    async ({ controller, rootDirectory, studioOrigin }) => {
      const demonstratedValue = "FORM-VALUE-MUST-NEVER-LEAK";
      await teachLegacyLayoutA(
        page,
        controller,
        studioOrigin,
        demonstratedValue,
      );
      controller.persistArtifacts = async () => {
        throw new Error(
          `Persistence rejected ${demonstratedValue} at http://local.test/compile?record=${demonstratedValue}&mode=test token=raw-token cookie=raw-cookie Authorization=Bearer raw-auth`,
        );
      };
      let delayNextStateRefresh = true;
      await page.route("**/api/state", async (route) => {
        if (delayNextStateRefresh) {
          delayNextStateRefresh = false;
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
        await route.continue();
      });

      const terminalMessages: string[] = [];
      const originalConsoleError = console.error;
      console.error = (...values: unknown[]) => {
        terminalMessages.push(values.map(String).join(" "));
      };
      try {
        await page
          .getByRole("button", { name: "Compile", exact: true })
          .click();
        await expect(page.locator("#compilationDiagnostics")).toBeVisible({
          timeout: 1_000,
        });
        await expect(
          page.getByRole("button", {
            name: "Copy diagnostics",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Clear", exact: true }),
        ).toBeVisible();
        await expect(page.locator("#studioState")).toHaveText(
          "DEMONSTRATION_REVIEW",
        );
        await expect(page.locator("#compilationDiagnostics")).toBeVisible();
        await expect(page.locator("#retryDiagnostic")).toBeEnabled();
      } finally {
        console.error = originalConsoleError;
      }

      await expect(page.locator("#diagnosticHttpStatus")).toHaveText("422");
      await expect(page.locator("#diagnosticCompilerStage")).toHaveText(
        "artifact-persistence",
      );
      const message = await page
        .locator("#diagnosticServerMessage")
        .innerText();
      expect(message).toContain("Persistence rejected");
      expect(message).toContain("http://local.test/compile");
      expect(message).not.toContain(demonstratedValue);
      expect(message).not.toContain("record=");
      expect(message).not.toContain("raw-token");
      expect(message).not.toContain("raw-cookie");
      expect(message).not.toContain("raw-auth");
      await expect(page.locator("#toast.error")).toBeHidden();
      await page.waitForTimeout(3_700);
      await expect(page.locator("#compilationDiagnostics")).toBeVisible();

      await page.reload();
      await expect(page.locator("#compilationDiagnostics")).toBeVisible();
      await expect(page.locator("#diagnosticServerMessage")).toHaveText(
        message,
      );

      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"], {
          origin: studioOrigin,
        });
      await page
        .getByRole("button", { name: "Copy diagnostics", exact: true })
        .click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain("HTTP status: 422");
      expect(copied).toContain("Stage: artifact-persistence");
      expect(copied).toContain(message);
      expect(copied).not.toContain(demonstratedValue);

      await page.locator("#advancedDetails > summary").click();
      await page
        .getByText("Persistent Studio event log", { exact: true })
        .click();
      await expect(page.locator("#studioEventLog")).toContainText(message);
      const persistedLog = await readFile(
        path.join(rootDirectory, "local-data", "studio-events.jsonl"),
        "utf8",
      );
      expect(persistedLog).toContain(message);
      expect(persistedLog).not.toContain(demonstratedValue);
      expect(persistedLog).not.toContain("record=");
      expect(persistedLog).not.toContain("raw-token");
      expect(persistedLog).not.toContain("raw-cookie");
      expect(persistedLog).not.toContain("raw-auth");

      const diagnostic = controller.compilationDiagnostic;
      expect(diagnostic).toBeDefined();
      expect(terminalMessages.join("\n")).toContain(JSON.stringify(diagnostic));
      expect(terminalMessages.join("\n")).not.toContain(demonstratedValue);

      await controller.reset();
      await page.reload();
      await expect(page.locator("#compilationDiagnostics")).toBeVisible();
      await expect(page.locator("#diagnosticServerMessage")).toHaveText(
        message,
      );

      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(page.locator("#compilationDiagnostics")).toBeHidden();
      await expect(page.locator("#studioEventLog")).toContainText(message);
    },
  );
});
