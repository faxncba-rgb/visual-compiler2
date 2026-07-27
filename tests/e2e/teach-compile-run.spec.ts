import { expect, test } from "@playwright/test";
import {
  DeterministicRuntime,
  createAnimatedPresentation,
} from "../../packages/deterministic-runtime/src";
import {
  compilePrimary,
  consultationEditor,
  fixtureOrigin,
  teachPrimaryWorkflow,
  withManagedBrowser,
} from "./helpers";

test.describe("required demonstration-first consultation workflow", () => {
  test("records the exact editor, compiles Semantic IR once, runs on layout B, and runs again", async () => {
    await withManagedBrowser(
      `${fixtureOrigin}/fixture?variant=A`,
      async ({ browser, page, recorder }) => {
        const { session, values, demonstratedValue } =
          await teachPrimaryWorkflow({ page, recorder });

        expect(session.authenticationExcluded).toBe(true);
        expect(
          session.actions
            .filter((action) => action.action === "fill")
            .map((action) => action.value),
        ).toEqual([
          {
            kind: "literal",
            value: demonstratedValue,
            persistence: "workflow",
          },
        ]);
        expect(session.actions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "fill",
              value: {
                kind: "literal",
                value: demonstratedValue,
                persistence: "workflow",
              },
              target: expect.objectContaining({
                associatedLabel: "Texte de consultation",
                role: "textbox",
                editable: true,
              }),
            }),
            expect.objectContaining({ action: "popup-open" }),
            expect.objectContaining({ action: "popup-close" }),
            expect.objectContaining({
              action: "click",
              observedEffects: expect.arrayContaining([
                expect.objectContaining({ type: "success-visible" }),
                expect.objectContaining({ type: "history-increased" }),
                expect.objectContaining({ type: "stability-reconciled" }),
              ]),
            }),
          ]),
        );
        expect(session.outcomeCandidates).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "relative-count-increase",
              observed: true,
              selected: true,
              required: true,
              beforeCount: 0,
              afterCount: 1,
            }),
          ]),
        );
        expect(
          session.actions.some(
            (action) => action.target?.inputType === "password",
          ),
        ).toBe(false);
        expect(JSON.stringify(session)).toContain(demonstratedValue);
        expect(JSON.stringify(session)).not.toContain("NEVER-RECORD-THIS");
        expect(values).toEqual({});

        const workflow = await compilePrimary({
          browser,
          session,
          values,
        });
        expect(workflow.compileMode).toBe("mock-ai-generalization");
        expect(workflow.compilationMetadata.model).toBe("gpt-5.6");
        expect(workflow.compilationMetadata.modelCalls).toBe(1);
        const fillStep = workflow.steps.find((step) => step.action === "fill");
        expect(fillStep?.target?.associatedLabel).toBe("Texte de consultation");
        expect(fillStep?.locatorCandidates[0]?.rule).toMatchObject({
          role: "textbox",
          name: "Texte de consultation",
        });
        expect(fillStep?.value).toEqual({
          kind: "literal",
          value: demonstratedValue,
          persistence: "workflow",
        });
        expect(JSON.stringify(workflow)).toContain(demonstratedValue);
        const generalized = await compilePrimary({
          browser,
          session,
          values,
          instruction:
            "Repeat the demonstrated actions on each following eligible row.",
        });
        expect(generalized.compileMode).toBe("mock-ai-generalization");
        expect(generalized.compilationMetadata.modelCalls).toBe(1);
        expect(generalized.loops[0]).toMatchObject({
          maximumIterations: 100,
          maximumDurationMs: 600_000,
          duplicateItemProtection: true,
        });

        await browser.navigate(`${fixtureOrigin}/fixture?variant=B`);
        const before = await page.evaluate(() => ({
          date: (
            document.querySelector(
              '[name="date_consultation"]',
            ) as HTMLInputElement
          ).value,
          time: (
            document.querySelector(
              '[name="heure_consultation"]',
            ) as HTMLInputElement
          ).value,
        }));
        const runtime = new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: values,
          mode: "local",
        });
        const first = await runtime.run();
        expect(first.state).toBe("Passed");
        expect(first.llmCalls).toBe(0);
        expect(first.openAIRequests).toBe(0);
        await expect(
          page
            .locator("[data-vc-consultation-history] > li")
            .filter({ hasText: demonstratedValue }),
        ).toHaveCount(1);
        await expect(await consultationEditor(page)).toHaveValue("");
        await expect(page.locator('[name="date_consultation"]')).toHaveValue(
          before.date,
        );
        await expect(page.locator('[name="heure_consultation"]')).toHaveValue(
          before.time,
        );
        await expect(page.locator("[data-vc-save-count]")).toHaveText("1");
        expect(
          browser.context.pages().filter((candidate) => !candidate.isClosed()),
        ).toHaveLength(1);

        await browser.navigate(`${fixtureOrigin}/fixture?variant=B`);
        const second = await new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: values,
          mode: "local",
        }).run();
        expect(second.state).toBe("Passed");
        expect(second.workflowId).toBe(first.workflowId);
        expect(second.llmCalls).toBe(0);
        expect(second.openAIRequests).toBe(0);
        await expect(page.locator("[data-vc-save-count]")).toHaveText("1");
      },
    );
  });

  test("local and animated modes execute the same artifact while local bypasses animation", async () => {
    await withManagedBrowser(
      `${fixtureOrigin}/fixture?variant=A`,
      async ({ browser, page, recorder }) => {
        const { session, values } = await teachPrimaryWorkflow({
          page,
          recorder,
        });
        const workflow = await compilePrimary({ browser, session, values });

        await browser.navigate(`${fixtureOrigin}/fixture?variant=A`);
        let localAnimationCalls = 0;
        const local = await new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: values,
          mode: "local",
        }).run();
        expect(local.state).toBe("Passed");
        expect(localAnimationCalls).toBe(0);

        await browser.navigate(`${fixtureOrigin}/fixture?variant=A`);
        let animatedCalls = 0;
        const presentation = createAnimatedPresentation(0);
        const animated = await new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: values,
          mode: "animated",
          animation: {
            async beforeStep(details) {
              animatedCalls += 1;
              await presentation.beforeStep?.(details);
            },
            async afterStep(details) {
              await presentation.afterStep?.(details);
            },
          },
        }).run();
        expect(animated.state).toBe("Passed");
        expect(animatedCalls).toBeGreaterThan(0);
        expect(animated.workflowId).toBe(local.workflowId);
        expect(animated.llmCalls).toBe(0);
        expect(animated.openAIRequests).toBe(0);
      },
    );
  });

  test("an application error cannot be reported as Passed", async () => {
    await withManagedBrowser(
      `${fixtureOrigin}/fixture?variant=A`,
      async ({ browser, page, recorder }) => {
        const { session, values } = await teachPrimaryWorkflow({
          page,
          recorder,
        });
        const workflow = await compilePrimary({ browser, session, values });
        await browser.navigate(`${fixtureOrigin}/fixture?variant=B&fail=1`);
        const telemetry = await new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: values,
          mode: "local",
        }).run();
        expect(telemetry.state).toBe("Failed");
        expect(telemetry.error).toContain("error marker");
        expect(telemetry.llmCalls).toBe(0);
        expect(telemetry.openAIRequests).toBe(0);
      },
    );
  });

  test("Stop aborts a deterministic run without an API key", async () => {
    await withManagedBrowser(
      `${fixtureOrigin}/fixture?variant=A`,
      async ({ browser, page, recorder }) => {
        const { session, values } = await teachPrimaryWorkflow({
          page,
          recorder,
        });
        const workflow = await compilePrimary({ browser, session, values });
        await browser.navigate(`${fixtureOrigin}/fixture?variant=A`);
        const controller = new AbortController();
        controller.abort();
        const previous = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        const telemetry = await new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: values,
          mode: "local",
          signal: controller.signal,
        }).run();
        if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
        expect(telemetry.state).toBe("Stopped");
        expect(telemetry.llmCalls).toBe(0);
        expect(telemetry.openAIRequests).toBe(0);
      },
    );
  });

  test("unexpected popups and blocked OpenAI HTTP/WebSocket attempts fail closed", async () => {
    await withManagedBrowser(
      `${fixtureOrigin}/fixture?variant=A`,
      async ({ browser, page, recorder }) => {
        const { session, values } = await teachPrimaryWorkflow({
          page,
          recorder,
        });
        const workflow = await compilePrimary({ browser, session, values });

        await browser.navigate(`${fixtureOrigin}/fixture?variant=A`);
        const unexpectedPromise = page.waitForEvent("popup");
        await page.evaluate(() => {
          window.open("/fixture/popup-action", "unexpected-popup");
        });
        const unexpected = await unexpectedPromise;
        const popupTelemetry = await new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: values,
          mode: "local",
        }).run();
        expect(popupTelemetry.state).toBe("Failed");
        expect(popupTelemetry.error).toContain("unmodeled popup");
        await unexpected.close();

        await browser.navigate(`${fixtureOrigin}/fixture?variant=A`);
        let attempted = false;
        const networkTelemetry = await new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: values,
          mode: "animated",
          animation: {
            async beforeStep() {
              if (attempted) return;
              attempted = true;
              await page.evaluate(async () => {
                await fetch("https://api.openai.com/v1/models").catch(
                  () => undefined,
                );
                await new Promise<void>((resolve) => {
                  const socket = new WebSocket(
                    "wss://api.openai.com/v1/realtime",
                  );
                  const done = () => resolve();
                  socket.addEventListener("close", done, { once: true });
                  socket.addEventListener("error", done, { once: true });
                  setTimeout(done, 250);
                });
              });
            },
          },
        }).run();
        expect(networkTelemetry.state).toBe("Failed");
        expect(networkTelemetry.error).toContain("blocked an attempted OpenAI");
        expect(networkTelemetry.llmCalls).toBe(0);
        expect(networkTelemetry.openAIRequests).toBe(0);
      },
    );
  });
});

test.describe("editor strategies", () => {
  for (const editor of ["contenteditable", "facade"] as const) {
    test(`${editor} preserves the demonstrated field and synchronizes local replay`, async () => {
      await withManagedBrowser(
        `${fixtureOrigin}/fixture?variant=A&editor=${editor}`,
        async ({ browser, page, recorder }) => {
          const value = `Synthetic ${editor} value`;
          await recorder.start();
          const field = page.getByLabel("Texte de consultation");
          await field.click();
          await field.fill(value);
          await page.waitForTimeout(380);
          await page.getByText("Enregistrer", { exact: true }).click();
          await page
            .getByText("Consultation synthétique enregistrée.")
            .waitFor();
          const session = await recorder.stop();
          const values = recorder.localValues;
          const workflow = await compilePrimary({ browser, session, values });
          await browser.navigate(
            `${fixtureOrigin}/fixture?variant=B&editor=${editor}`,
          );
          const telemetry = await new DeterministicRuntime({
            context: browser.context,
            workflow,
            variables: values,
            mode: "local",
          }).run();
          expect(telemetry.state).toBe("Passed");
          await expect(page.getByLabel("Texte de consultation")).toHaveText("");
          if (editor === "facade") {
            await expect(
              page.locator('[name="consultation_backing"]'),
            ).toHaveValue("");
          }
        },
      );
    });
  }

  test("keyboard-dependent editor compiles sequential keys and verifies the value", async () => {
    await withManagedBrowser(
      `${fixtureOrigin}/fixture?variant=A&editor=keyboard`,
      async ({ browser, page, recorder }) => {
        const value = "Synthetic keyboard-dependent value";
        await recorder.start();
        const field = page.getByLabel("Texte de consultation");
        await field.click();
        await field.pressSequentially(value);
        await page.getByText("Enregistrer", { exact: true }).click();
        await page.getByText("Consultation synthétique enregistrée.").waitFor();
        const session = await recorder.stop();
        const workflow = await compilePrimary({
          browser,
          session,
          values: recorder.localValues,
        });
        expect(
          workflow.steps.find((step) => step.action === "fill")
            ?.inputStrategies,
        ).toEqual(["sequential-keys", "native-value-setter"]);

        await browser.navigate(
          `${fixtureOrigin}/fixture?variant=B&editor=keyboard`,
        );
        const telemetry = await new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: {},
          mode: "local",
        }).run();
        expect(telemetry.state, telemetry.error).toBe("Passed");
        expect(
          telemetry.steps.find((step) => step.action === "fill")?.message,
        ).toContain("sequential-keys");
        await expect(
          page.locator("[data-vc-consultation-history] > li"),
        ).toContainText(value);
      },
    );
  });

  test("failed value verification stops before Enregistrer", async () => {
    await withManagedBrowser(
      `${fixtureOrigin}/fixture?variant=A&editor=textarea`,
      async ({ browser, page, recorder }) => {
        const { session } = await teachPrimaryWorkflow({
          page,
          recorder,
          value: "Synthetic value that must be verified",
        });
        const workflow = await compilePrimary({
          browser,
          session,
          values: recorder.localValues,
        });
        await browser.navigate(
          `${fixtureOrigin}/fixture?variant=B&editor=textarea&rejectInput=1`,
        );
        const telemetry = await new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: {},
          mode: "local",
        }).run();
        expect(telemetry.state).toBe("Failed");
        expect(telemetry.error).toContain("value-verification phase");
        await expect(page.locator("[data-vc-save-count]")).toHaveText("0");
      },
    );
  });

  test("same-origin iframe editor replays while cross-origin frame content stays excluded", async () => {
    await withManagedBrowser(
      `${fixtureOrigin}/fixture?variant=A&editor=iframe`,
      async ({ browser, page, recorder }) => {
        await page.evaluate(() => {
          const iframe = document.createElement("iframe");
          iframe.title = "Opaque cross-origin support";
          iframe.src = `http://localhost:${location.port}/fixture/cross-origin?patient=must-redact`;
          document.body.append(iframe);
        });
        await page
          .frameLocator('iframe[title="Opaque cross-origin support"]')
          .getByLabel("External note")
          .waitFor();
        await recorder.start();
        await page
          .frameLocator('iframe[title="Opaque cross-origin support"]')
          .getByLabel("External note")
          .fill("OPAQUE-CONTENT");
        const editor = page
          .frameLocator('iframe[title="Éditeur de consultation"]')
          .getByLabel("Texte de consultation");
        await editor.fill("Iframe consultation value");
        await page.waitForTimeout(380);
        await page.getByText("Enregistrer", { exact: true }).click();
        await page.getByText("Consultation synthétique enregistrée.").waitFor();
        const session = await recorder.stop();
        expect(JSON.stringify(session)).not.toContain("OPAQUE-CONTENT");
        expect(recorder.status().crossOriginEventsExcluded).toBeGreaterThan(0);
        const values = recorder.localValues;
        const workflow = await compilePrimary({ browser, session, values });
        await browser.navigate(
          `${fixtureOrigin}/fixture?variant=B&editor=iframe`,
        );
        const telemetry = await new DeterministicRuntime({
          context: browser.context,
          workflow,
          variables: values,
          mode: "local",
        }).run();
        expect(telemetry.state, telemetry.error).toBe("Passed");
        await expect(
          page
            .frameLocator('iframe[title="Éditeur de consultation"]')
            .getByLabel("Texte de consultation"),
        ).toHaveValue("");
      },
    );
  });
});
