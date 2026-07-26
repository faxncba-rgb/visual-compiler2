# Progress

## Current milestone

Milestone 15.2 — editing transactions and final-value capture.

## Milestone objective

- Persist authorized demonstrated text as a first-class workflow literal.
- Capture an editable target on focus and retain every final value independently
  of the lifetime of its DOM node.
- Consolidate input, change, composition, paste, key and selection signals into
  one editing action.

## Milestone 15.1 finding

- The recorder stores a pending DOM-node timer and reads the value later.
- It flushes on `change`, but not synchronously before every causal boundary
  and not from `Stop teaching`.
- The existing synthetic helpers wait 300–1,100 ms, masking the same race seen
  in controlled use.

## Milestone 15.2 implementation

- Added explicit `literal/workflow` and `runtime-variable/memory-only` value
  types while retaining legacy value references for compatible loading.
- Replaced the delayed DOM-node timer with a durable edit transaction updated
  on every input and committed at focus, click, submit, unload and Stop
  boundaries.
- Captured the target descriptor at transaction start, consolidated duplicate
  browser events and excluded authentication-like controls before value
  capture.
- Removed the artificial typing delay from the primary regression path.

## Milestone 15.2 validation

- Detached-frame smoke: the previously missing edit is now recorded.
- Immediate `fill → Enregistrer` smoke: one fill precedes one linked save.
- Primary Layout A → Layout B compile/run/run-again E2E: passed with the
  literal in the artifact, Date and Heure unchanged and one save per run.
- TypeScript build and focused IR/recorder/value unit suite: passed.

## Remaining after Milestone 15.2

- Runtime input strategies still need explicit ordered fallbacks and mandatory
  post-entry verification.
- Copy/paste still records a typed literal rather than memory-only dataflow.
- Workflow Library and automatic Teaching trace remain to be implemented.

## Completed

- Replaced fixture/profile selection with one OPEN → TEACH → COMPILE → RUN
  LOCALLY interface.
- Added automatic managed-browser startup, DPI home return, reopen recovery and
  a dedicated permission-restricted `.local/browser-profile/`.
- Kept authentication manual and recording inactive until explicit Start
  teaching.
- Added monotonic action sequence, causal graph-event links, per-action bounded
  reaction observation and resulting structural state.
- Consolidated ordinary typing while preserving meaningful keys and shortcuts.
- Added checked/selected target evidence and browser-backed checkbox, dropdown
  and menu regressions.
- Preserved actionable-ancestor promotion, dialogs, popup actions and closure,
  same-origin iframe recording, frame replacement and live reacquisition.
- Simplified outcome selection to the strongest observed evidence.
- Allowed compilation and local execution without positive evidence.
- Added VERIFIED, PARTIALLY_VERIFIED and UNVERIFIED artifacts, with PASSED
  distinct from COMPLETED_UNVERIFIED.
- Preserved known-error, unexpected-popup and missing required verified-outcome
  failures.
- Moved raw IR, payload, locators and logs into collapsed Advanced details.
- Kept optional AI generalization collapsed and direct empty-instruction
  compilation model-free.
- Generalized persistent diagnostics across browser, compile, request and
  runtime errors; added copy, clear, contextual retry, terminal and JSONL
  persistence.
- Migrated stored demonstrations to metadata version 2 and defaulted missing
  outcome data to UNVERIFIED without deleting user files.
- Forced automated Studio startup to an explicit local target.

## Validation

- `npm run build`: passed.
- `npm test`: 48/48 passed across 8 files.
- `npm run test:security`: 7/7 passed.
- `npm run test:e2e`: 23/23 passed.

## Deliberate boundaries

- No live OpenAI adapter is enabled.
- Runtime blocks OpenAI HTTP and WebSocket access.
- Cross-origin frames remain opaque.
- Automated tests use only local synthetic fixtures.
- The real DPI test remains a manual operator step.
