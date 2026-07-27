# Codex collaboration guide

This repository is developed on
`codex/teach-by-demonstration-mvp`. Do not merge `main`, force-push or contact
the real DPI from automation. Live OpenAI access is compile-time only; tests
must inject the structured GPT mock.

## Product invariants

- Keep the primary journey **OPEN → TEACH → COMPILE → RUN LOCALLY**.
- Do not add primary lifecycle buttons. The only additional visible feature is
  the Workflow name field, Saved workflows selector and passive library status.
- Authentication remains manual in the dedicated browser and recording remains
  off until **Start teaching**.
- A runtime result is `PASSED` only with verified positive evidence. Successful
  actions without proof are `COMPLETED_UNVERIFIED`; action, locator, value,
  popup or outcome failures are `FAILED`.
- Compilation/runtime diagnostics are persistent, redacted, copyable, appended
  to the local Studio event log and written to the terminal.

## Value and persistence contract

- Directly demonstrated non-sensitive text is an authorized
  `{ kind: "literal", persistence: "workflow" }` constant. Preserve it exactly
  in the local workflow artifact and on replay.
- Copied page content is represented by
  `{ kind: "runtime-variable", persistence: "memory-only" }`. Never serialize
  the copied content into artifacts, generated source, events, traces,
  telemetry or diagnostics.
- Never capture credentials, authentication-like fields, cookies, storage,
  authorization/CSRF data, session identifiers, query parameters, browser
  profiles, secrets or API keys.
- Library versions under `local-data/workflow-library/` are immutable. Create a
  new version; do not overwrite a validated older bundle.

## Recorder and runtime contract

- Treat editing as a transaction. Capture target identity at focus/start,
  consolidate input/change/composition/paste signals and flush before click,
  submit, navigation, detach, close and Stop teaching.
- Persist semantic page/frame/popup identity, never durable Playwright object or
  element handles. Reacquire the current live object at compile/run time.
- Use ordered bounded entry strategies and verify the resulting target value
  before executing the next action. A failed fill must not reach the save click.
- Keep runtime imports free of OpenAI packages and keep HTTP/WebSocket OpenAI
  blocking tests. Runtime counters must remain `llmCalls: 0` and
  `openAIRequests: 0`.

## Required validation

Use only local synthetic fixtures:

```bash
npm ci
npm run build
npm test
npm run test:security
npm run test:e2e
git diff --check
git status --short --branch
```

Also run the exact `npm run dev` loader smoke, inspect ignored local artifacts
and logs for forbidden content, and inspect the runtime source/dependency graph
for OpenAI imports. Preserve unrelated user files and untracked local
artifacts.

## Known unsupported boundaries

Do not claim universal website support. Cross-origin frame internals, closed
shadow DOM and copy/paste implementations without observable legitimate DOM
events remain unsupported. Real DPI validation is performed only by the
authorized operator using the procedure in `docs/MANUAL_TEST.md`.
