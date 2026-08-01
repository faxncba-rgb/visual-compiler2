# Security and privacy

Visual Compiler 2 is a local tool for authorized workflows on synthetic test
records. Studio binds to `127.0.0.1`.

## Authentication and browser profile

Authentication is manual inside the dedicated managed browser. Studio never
requests credentials and the recorder remains inactive until **Start
teaching**. Password targets are rejected before entering the Demonstration IR.

The managed profile is isolated under `.local/browser-profile/`, Git-ignored
and permissioned `0700` where supported. Visual Compiler 2 does not read or
reuse profiles from another browser or project. Cookies and storage remain
under the operator's local control and are never copied to artifacts, logs,
diagnostics or AI payloads.

## Persistence and redaction

Persisted page identity contains only canonical origin and pathname. Query
parameters, hashes, patient/session identifiers, cookies, tokens, passwords,
browser storage and authorization data are excluded from semantic artifacts and
diagnostic records.

Demonstrated non-sensitive text is intentionally allowed in local workflow
artifacts as an authorized `{ kind: "literal", persistence: "workflow" }`
constant. Authentication-like controls are rejected before their value is
captured. Text extracted from a page by a copy/paste demonstration uses a
`runtime-variable / memory-only` reference: its content exists only in the
per-run memory map and is absent from workflow definitions, generated source,
Studio events, traces, telemetry and diagnostics.

Diagnostics use one redacted object for the visible panel, clipboard, terminal
and `local-data/studio-events.jsonl`. Redaction covers live form values and
authorized session/workflow literals in addition to explicit generalization
text, secret-shaped fields and query-bearing URLs. A compile/runtime failure is
not reduced to a temporary toast: the redacted object stays visible until a
successful operation or explicit **Clear**.

Workflow Library bundles/indexes and Teaching traces live under Git-ignored
`local-data/` with mode `0600` where supported. Trace JSONL contains structural
Before/Action/After metadata but no typed/copied content or visible page text.
Synthetic automated fixtures may persist trace screenshots; normal managed DPI
sessions persist metadata only.

## Network boundaries

Normal Lab Mode defaults to the configured HTTPS DPI home. Automated test mode
requires an explicit local HTTP URL and rejects any remote target, including
the real DPI. The checked-in Playwright web server command always sets the local
test override.

Normal Compile makes one GPT-5.6 Responses API request with a rich redacted
trace and strict Structured Outputs. The key is read only from ignored
`.env.local` with mode `0600`, captured by the compile-only provider and removed
from `process.env`. Automated tests use a mock and make no OpenAI request.

The runtime has no OpenAI dependency, does not require or receive
`OPENAI_API_KEY`, and blocks OpenAI HTTP and WebSocket endpoints before
dispatch. An attempted runtime call is reported as a failed policy check while
telemetry remains `llmCalls: 0` and `openAIRequests: 0`.

Runtime source and dependency-graph checks are part of final validation. No
OpenAI SDK package is imported or installed.

## Supported use

Allowed: local, authorized, synthetic browser workflow development.

Excluded: credential capture, CAPTCHA bypass, stealth or anti-detection,
unauthorized access, real patient data and autonomous clinical decisions.

Cross-origin frame contents and closed shadow DOM are deliberately not
inspected. Copy/paste dataflow requires observable browser events; invisible
application-private channels are unsupported.

Report vulnerabilities privately without attaching credentials, browser
profiles, local values or sensitive screenshots.
