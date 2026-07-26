# Progress

## Current milestone

Milestone 15.4 — deterministic input strategies and verification.

## Milestone objective

- Compile an explicit ordered input-strategy list for every demonstrated edit.
- Verify the visible value and any legacy backing field before the next action.
- Fail before Enregistrer if every bounded input strategy fails.

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

## Milestone 15.3 implementation

- Added recorder installation on every `frameattached` event in addition to
  context init scripts and navigation hooks.
- Kept recorded page/frame identities structural and reacquired fresh live
  Playwright roots after detachment.
- Strengthened runtime frame resolution with origin, canonical pathname,
  frame name and normalized title, with honest failure for zero or multiple
  matches.

## Milestone 15.3 validation

- TypeScript build and locator-resolution unit suite: passed.
- Same-origin editor-frame replacement and cross-origin opacity E2E: passed.
- Popup action, closure/return and unexpected-popup failure E2E: passed.

## Remaining after Milestone 15.3

- Page/frame structural reacquisition is limited to same-origin content and
  known canonical identities; cross-origin internals intentionally remain
  opaque.
- Deterministic input strategy fallback and value verification are next.

## Milestone 15.4 implementation

- Compiled standard fill, contenteditable fill, sequential keys, legacy backing
  synchronization and final native-setter fallback in a deterministic order.
- Added mandatory post-entry checks for input/textarea/select values,
  contenteditable text and legacy backing controls.
- Added post-action checkbox/radio state verification.
- Added a keyboard-dependent synthetic editor and a rejecting editor fixture;
  failed verification aborts the run before the save click.
- Included persisted workflow literals in diagnostic redaction inputs without
  removing them from the executable workflow artifact.

## Milestone 15.4 validation

- TypeScript build: passed.
- Contenteditable, legacy facade, keyboard-dependent and rejecting-editor E2E:
  4/4 passed.
- Rejecting-editor telemetry is FAILED in the value-verification phase and its
  save counter remains zero.

## Remaining after Milestone 15.4

- Native setter is deliberately the final Lab fallback and does not claim
  compatibility with closed-shadow or cross-origin editors.
- Explicit copy/paste dataflow is next.

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
