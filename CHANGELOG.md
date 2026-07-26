# Changelog

## 0.1.0 — Unreleased

- Simplify Studio to OPEN → TEACH → COMPILE → RUN LOCALLY and remove all
  user-facing application/fixture profiles.
- Automatically open a dedicated managed browser on the configured Lab home;
  preserve fully manual authentication and explicit recorder start.
- Add monotonic temporal actions, causal popup/navigation/frame links,
  per-action stable-state snapshots and checkbox/dropdown/menu capture.
- Compile demonstrations with missing outcomes and report
  COMPLETED_UNVERIFIED instead of incorrectly reporting PASSED.
- Automatically select only the strongest derived outcome evidence.
- Expand persistent redacted diagnostics to browser, compiler, request and
  runtime failures with Copy, Clear, contextual Retry, terminal and JSONL log.
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
