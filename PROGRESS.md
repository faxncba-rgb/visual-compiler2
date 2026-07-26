# Progress

## Current milestone

Milestone 11 — Legacy DPI same-page rerender and compile-retry hardening.

## Completed

- Read-only audit of Visual Compiler 1 and visual-compiler-next.
- Dedicated TypeScript monorepo configuration.
- Architecture, security, migration, and ADR foundations.
- Synthetic legacy DPI layouts and editor/popup variants.
- Initial managed browser, Page Context Graph, recorder, IR, locator,
  compiler, runtime, and Studio implementation.
- Direct demonstration compilation and strict mocked AI generalization.
- Deterministic Run locally, optional animated presentation, Run again, and
  AbortSignal Stop.
- Positive outcome verification, negative error markers, unexpected-popup
  failure, and OpenAI HTTP/WebSocket interception.
- Polished local Studio, GitHub CI, visual QA screenshot, and manual test guide.
- Stable `DemonstratedTargetDescriptor` evidence separated from ephemeral DOM,
  generated ID/class, value, history, and page-instance identity.
- Same-path live semantic frame resolution after the Legacy DPI save rerender.
- Retry-safe compilation state, persistent redacted structural diagnostics, and
  a targeted synthetic-fixture reset that preserves compiled workflows.
- Browser-backed regressions for rerender/compile/run and 422 correction/retry
  through the real Studio controls and managed-browser recorder.

## Tests

- `npm run build`: passed.
- `npm test`: 36/36 passed across 8 files.
- `npm run test:security`: 5/5 passed.
- `npm run test:e2e`: 16/16 passed.

## Demo readiness

Ready for the bundled synthetic Lab Mode demonstration.

## Known issues

- Live GPT generalization is deliberately disabled; the MVP will use strict
  mocked structured output.
- The live GPT adapter remains deliberately out of scope until separately
  authorized.
- Cross-origin frames are opaque lifecycle contexts by design.
- The repeated-row runtime exposes and tests the bounded loop engine; a rich
  visual loop editor is planned after the MVP.

## Next actions

1. Publish only `codex/teach-by-demonstration-mvp`.
2. Conduct the concise manual Legacy DPI layout A retest.
