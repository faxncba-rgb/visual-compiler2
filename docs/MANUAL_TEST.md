# Manual real Lab Mode retest

This procedure is performed by the authorized operator. Automated development
does not contact the real DPI.

1. In `/Users/mbam5/Documents/visual-compiler2`, verify branch
   `codex/teach-by-demonstration-mvp` and run `npm run dev`.
2. Open <http://127.0.0.1:3100>. Confirm **LAB MODE**, no application profile
   selector and Browser status **OPEN**.
3. In the automatically opened managed browser, authenticate manually and
   navigate to the authorized synthetic patient and Legacy DPI layout A.
4. Confirm Recorder remains **OFF** throughout authentication and navigation.
5. Select **Start teaching** in Studio. In the managed browser, fill only the
   demonstrated consultation editor, select **Enregistrer**, wait for the
   validation popup to close and the page to settle, then select **Stop
   teaching**.
6. Confirm the concise timeline is chronological, ordinary text is one fill,
   the nested Enregistrer target is the actionable link, popup/frame events
   follow it causally and the summary reports executable actions.
7. Leave **Optional AI generalization** empty. Confirm
   **Direct local compilation — no AI call**, then select **Compile**.
8. Confirm `READY_TO_RUN` and no diagnostics. Open **Advanced details** only if
   you need to inspect the Page Context Graph, variable or selected locator.
9. Set the local consultation value if desired, select **Run locally**, and
   confirm exactly one save, popup completion, editor reset and expected
   history/result.
10. Confirm result `PASSED`, Runtime LLM calls `0`, Runtime OpenAI requests `0`.
11. Select **Run again** and confirm one additional deterministic replay without
    re-teaching or recompiling.

## Unverified-outcome retest

1. Start a fresh teaching session, perform at least one executable edit but no
   action that creates positive success evidence, then stop.
2. Confirm Compile remains enabled and compile succeeds.
3. Select Run locally and confirm `COMPLETED_UNVERIFIED`, never `PASSED`.

## Persistent diagnostic retest

1. Trigger a synthetic/local compile ambiguity or other safe failure.
2. Confirm the red diagnostic card appears immediately with HTTP status `422`,
   stage, workflow state and redacted message.
3. Confirm **Retry compile**, **Copy diagnostics** and **Clear** are visible.
4. Wait and reload Studio; confirm the diagnostic remains visible.
5. Copy it and confirm no form value, patient/query parameter, cookie, token,
   password or authentication header is present.
6. Open **Advanced details → Persistent Studio event log** and confirm the same
   redacted record; confirm it is also in the Studio terminal.
7. Correct the ambiguity and choose **Retry compile** without re-teaching.
8. Trigger another diagnostic, select **Clear**, and confirm only the visible
   card clears while the append-only event log remains.
