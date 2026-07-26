# Security and privacy

Visual Compiler 2 is an authorized local developer tool for synthetic test
records. Studio binds to `127.0.0.1` by default and automated development uses
only the bundled synthetic DPI.

## Authentication

Authentication is manual and happens before teaching. The recorder rejects
password controls, browser cookies, local/session storage, tokens,
authorization headers, and authentication popups. Browser profiles stay under
the local Git-ignored `browser-profiles/` directory.

## Redaction

Persisted page identities contain origin and canonical pathname only. Query
parameters, hashes, form values, patient-like identifiers, unstable values, and
secrets are removed from artifacts, logs, diagnostics, screenshots metadata,
and AI payload previews. Runtime variable values are stored separately under
Git-ignored `local-data/`.

## Network boundary

The direct and mocked compilers make no OpenAI request. A future live
compile-time adapter must require explicit confirmation. The runtime never
imports OpenAI, never reads an API key, and installs HTTP/WebSocket interception
that aborts OpenAI-domain traffic.

## Supported use

Allowed: local, authorized, synthetic browser workflow development.

Excluded: credential capture, CAPTCHA bypass, stealth or anti-detection,
unauthorized access, real patient data, and autonomous clinical decisions.

Report vulnerabilities privately to the repository owner without attaching
credentials, browser profiles, workflow values, or sensitive screenshots.
