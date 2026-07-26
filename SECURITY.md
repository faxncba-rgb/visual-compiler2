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
parameters, hashes, form values, patient-like identifiers, cookies, tokens,
passwords, browser storage and authorization data are excluded from semantic
artifacts and diagnostic records. Runtime values are stored separately under
Git-ignored `local-data/`.

Diagnostics use one redacted object for the visible panel, clipboard, terminal
and `local-data/studio-events.jsonl`. Redaction covers live form values and
explicit generalization text in addition to secret-shaped fields and
query-bearing URLs.

## Network boundaries

Normal Lab Mode defaults to the configured HTTPS DPI home. Automated test mode
requires an explicit local HTTP URL and rejects any remote target, including
the real DPI. The checked-in Playwright web server command always sets the local
test override.

Direct compilation and the mocked generalizer make no OpenAI request. The
runtime has no OpenAI dependency, does not require `OPENAI_API_KEY`, and blocks
OpenAI HTTP and WebSocket endpoints before dispatch. An attempted call is
reported as a failed policy check while telemetry remains `llmCalls: 0` and
`openAIRequests: 0`.

## Supported use

Allowed: local, authorized, synthetic browser workflow development.

Excluded: credential capture, CAPTCHA bypass, stealth or anti-detection,
unauthorized access, real patient data and autonomous clinical decisions.

Report vulnerabilities privately without attaching credentials, browser
profiles, local values or sensitive screenshots.
