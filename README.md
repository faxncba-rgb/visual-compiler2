# Visual Compiler 2

**Open automatically → Teach → Compile → Run locally**

Visual Compiler 2 is a local, demonstration-first browser workflow compiler
for an authorized synthetic testing environment. Studio launches its own
Playwright-managed Chromium, the operator authenticates and navigates manually,
and recording begins only after **Start teaching**. A stopped demonstration
compiles into a deterministic artifact that runs locally without OpenAI.

![Visual Compiler 2 Lab Studio](docs/screenshots/studio-lab.png)

## Lab Mode

Normal Lab Mode uses this documented default:

```text
VISUAL_COMPILER_TARGET_URL=https://dpi-ncba.gbna-sante.fr/
```

On startup, Studio automatically opens that home page in the dedicated
Git-ignored profile `.local/browser-profile/`. The profile is created with
restrictive local permissions where supported and is never shared with another
project. **Reopen managed browser** recovers a manually closed browser and
**Return to DPI home** navigates back to the configured home.

Authentication happens only inside the managed browser. Studio never asks for
credentials. Password fields, cookies, tokens, storage, authorization data and
query parameters are not recorded or persisted. The user navigates to an
authorized synthetic patient before selecting **Start teaching**.

## Use

Requirements: Node.js 20+, npm, and Chromium installed for Playwright.

```bash
npm ci
npx playwright install chromium
npm run dev
```

Open <http://127.0.0.1:3100>. The normal flow is:

1. Authenticate and navigate manually in the browser that opened
   automatically.
2. Select **Start teaching**, perform the workflow, then **Stop teaching**.
3. Review the concise chronological timeline and select **Compile**.
4. Select **Run locally**. Use **Run again** to replay the same artifact.

**1st run — animated** is an optional presentation mode. It uses the same
artifact and runtime as local execution; local execution supplies no animation
callbacks and requires no per-step confirmation.

The optional **AI generalization** area is collapsed by default. When empty,
Studio shows **Direct local compilation — no AI call**. The current generalized
provider is a validated mock and makes no network request.

## Teaching and causal recording

The recorder consolidates raw browser noise into high-level actions:

- click and double click, promoting nested targets to the actionable ancestor;
- one fill action for an ordinary typing burst;
- meaningful keys and shortcuts, including Tab, Enter, Escape and arrows;
- check, uncheck, select, submit and causally relevant focus;
- actions in same-origin frames and managed popups;
- popup, dialog, navigation, frame replacement and closure events.

Every action has a monotonic sequence and time offset, stable page/frame
context, semantic target descriptor, action compatibility, observed reactions,
resulting stable state and causal links where later browser events were caused
by a human action. The Page Context Graph stores stable semantic identities,
not Playwright `Page` or `Frame` objects. Stop teaching performs bounded DOM
quiet detection and reconciles late popup, rerender, iframe and outcome
effects.

Target descriptors use accessibility names, labels, control family, editable,
readonly, enabled, checked/selected state, form and semantic container,
neighbors, frame/page description, stable attributes and secondary geometry.
Coordinates are never a primary locator, and a field is never selected merely
because it is the first textbox.

## Compilation and outcomes

Compile is enabled after teaching stops when at least one executable action was
recorded. Missing outcome evidence does not block compilation or local
execution. Studio automatically selects only the strongest observed outcome:

- `VERIFIED`: strong positive evidence was reconciled;
- `PARTIALLY_VERIFIED`: some evidence exists but is not strong enough;
- `UNVERIFIED`: no positive outcome was derived.

Runtime results are intentionally distinct:

- `PASSED`: actions completed and required positive evidence was verified;
- `COMPLETED_UNVERIFIED`: actions completed without a verifiable positive
  outcome;
- `FAILED`: an action failed, required verified evidence was absent, or a known
  error/negative condition appeared;
- `STOPPED`: the user aborted execution.

Visual Compiler 2 never reports `PASSED` from action completion alone.

## Persistent diagnostics

Every browser-open, compile, request or runtime failure produces a persistent
redacted diagnostics card. It remains visible until a new compilation or an
explicit **Clear**. **Retry** performs the relevant browser, compile or runtime
operation and **Copy diagnostics** copies one paste-ready block containing the
timestamp, HTTP status, stage, workflow state, redacted server message and
available step/target/locator/reaction evidence.

The same record is appended to `local-data/studio-events.jsonl` and written to
the Studio terminal. Form values, patient data, full query-bearing URLs,
cookies, tokens, storage, passwords and authentication headers are excluded.
Raw IR, locators, generated outline, payload preview and logs live in the
collapsed **Advanced details** section.

## Stored demonstrations

The last completed demonstration is stored under
`local-data/last-demonstration/` with structural session data and local values
in separate files. Restore requires a compatible live page structure. Existing
demonstrations that lack outcome evidence migrate to `UNVERIFIED` and remain
compilable; they are not deleted.

All browser profiles, local values, demonstrations, compiled artifacts and
event logs are Git-ignored.

## Internal test fixtures

Synthetic layouts and security pages are internal test fixtures only. They are
not application profiles and never appear in the normal Studio UI. Automated
tests must set an explicit local target:

```bash
VC_TEST_MODE=1 \
VISUAL_COMPILER_TEST_TARGET_URL=http://127.0.0.1:4273/fixture?variant=A \
npm run dev
```

Test mode rejects non-local targets. The Playwright configuration always uses
the local override, so automated tests do not contact the real DPI.

## Verification

```bash
npm run build
npm test
npm run test:security
npm run test:e2e
```

The deterministic runtime has no OpenAI dependency, does not read an API key,
and blocks OpenAI HTTP and WebSocket endpoints. Telemetry always exposes
`llmCalls` and `openAIRequests`; successful local runs keep both at zero.

See [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md),
[MIGRATION_NOTES.md](MIGRATION_NOTES.md), [DECISIONS.md](DECISIONS.md), and
[docs/MANUAL_TEST.md](docs/MANUAL_TEST.md).
