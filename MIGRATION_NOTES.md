# Migration notes

## From profile-driven Studio to Lab Mode

The user-facing synthetic application profile selector has been removed.
Fixtures remain internal test pages selected only through
`VISUAL_COMPILER_TEST_TARGET_URL`. Normal Lab Mode uses
`VISUAL_COMPILER_TARGET_URL`, defaulting to
`https://dpi-ncba.gbna-sante.fr/`, and opens the managed browser automatically.

No fixture profile ID is needed by new stored demonstrations. Metadata version
2 records only the configured target origin plus canonical live origin/path and
the structural fingerprint. Version 1 metadata is read and converted in memory.

## Existing demonstrations

Existing files are not deleted. Zod defaults migrate sessions that lack
`outcomeCandidates` or `outcomeVerification` to:

```text
outcomeVerification = UNVERIFIED
```

They remain compilable when they contain at least one executable action.
Structural compatibility is still required before restore, and local values
remain in their separate ignored file.

Actions lacking sequence numbers receive stable monotonic numbers in their
stored order when restored. New recordings also persist per-action resulting
state and causal links for subsequent graph events.

## Outcome behavior change

Older behavior treated missing positive evidence as a compile or runtime
failure. New behavior distinguishes:

- verified evidence and successful checks → `PASSED`;
- actions completed without verifiable positive evidence →
  `COMPLETED_UNVERIFIED`;
- known errors, action/locator failures or missing required verified evidence →
  `FAILED`.

The compiler chooses only the strongest observed candidate. Existing candidate
arrays remain readable; they no longer overload the default UI.

## Local data locations

The dedicated browser profile is now `.local/browser-profile/`.
Demonstrations, variable values, compiled artifacts and
`local-data/studio-events.jsonl` remain Git-ignored. No migration copies browser
profiles or authentication state from Visual Compiler 1 or another project.

## Preserved boundaries

- normal compilation calls GPT-5.6 once and validates structured Semantic IR;
- automated compilation is mocked and makes no OpenAI request;
- runtime contains no OpenAI client and blocks OpenAI HTTP/WebSocket access;
- query parameters, authentication data and form values remain outside
  artifacts and diagnostics;
- live Playwright objects are reacquired from stable Page Context Graph
  descriptions.
