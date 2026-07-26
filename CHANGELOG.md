# Changelog

## 0.1.0 — Unreleased

- Simplify Studio to OPEN → TEACH → COMPILE → RUN LOCALLY and remove all
  user-facing application/fixture profiles.
- Automatically open a dedicated managed browser on the configured Lab home;
  preserve fully manual authentication and explicit recorder start.
- Add monotonic temporal actions, causal popup/navigation/frame links,
  per-action stable-state snapshots and checkbox/dropdown/menu capture.
- Replace delayed DOM-node value reads with durable editing transactions that
  flush before causal boundaries and preserve the initial semantic target
  through rerenders and iframe replacement.
- Persist authorized demonstrated text as explicit workflow literals; compile
  copy/paste as extract plus memory-only runtime dataflow while rejecting
  authentication values.
- Add ordered deterministic input strategies with mandatory post-entry value
  verification so a failed fill aborts before the following save.
- Reacquire live pages, popups and same-origin frames from semantic identity;
  cover popup editing, closure/return, dialogs and replaced frames.
- Add the minimal Workflow Library with automatic immutable versioning,
  restart-safe selection, last-run status and compatible legacy discovery.
- Add automatic redacted Before/Action/After Teaching traces, with screenshots
  restricted to synthetic automated fixtures.
- Patch Playwright to 1.55.1 and Vitest to 3.2.6, the minimum advisory-fixed
  releases; production dependency audit is clean.
- Compile demonstrations with missing outcomes and report
  COMPLETED_UNVERIFIED instead of incorrectly reporting PASSED.
- Automatically select only the strongest derived outcome evidence.
- Expand persistent redacted diagnostics to browser, compiler, request and
  runtime failures with Copy, Clear, contextual Retry, terminal and JSONL log;
  keep failures visible through failed retries until success or explicit Clear.
- Move raw developer artifacts into collapsed Advanced details and keep
  optional AI generalization collapsed.
- Restrict automated targets to explicit local URLs and isolate the browser
  profile under `.local/browser-profile/`.
- Establish demonstration-first TypeScript monorepo and local Lab Mode
  architecture.
- Add a real persistent managed browser recorder with page/frame/popup graph.
- Add direct and mocked-generalization compilers with validated Zod IR.
- Add zero-LLM deterministic local/animated runtime, positive outcomes, Stop,
  and Run again.
- Add synthetic legacy DPI variants, editor adapters, popup/dialog fixtures,
  Studio UI, security controls, CI, and full test coverage.
- Document compile-time/runtime isolation and migration lessons.
