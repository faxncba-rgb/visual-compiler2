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
7. Enter a unique synthetic name in **Workflow name**. Leave the optional
   GPT-5.6 instruction empty. Confirm **GPT-5.6 compile-time compilation
   ready**, then select **Compile**.
8. Confirm `READY_TO_RUN`, the passive **Saved locally** status and the new
   immutable version in **Saved workflows**. Confirm there are no diagnostics.
   Open **Advanced details** only if you need to inspect the Page Context Graph
   or selected locator.
9. Select **Run locally** without entering another value. Confirm the exact
   demonstrated literal is reinserted into the consultation editor, Date and
   Heure remain unchanged, **Enregistrer** is invoked exactly once, the popup
   completes, the editor resets and the expected history/result appears.
10. Confirm the artifact reports model `gpt-5.6` and one compile-time model
    call. Confirm result `PASSED`, Runtime LLM calls `0`, Runtime OpenAI
    requests `0`.
11. Select **Run again** and confirm one additional deterministic replay without
    re-teaching or recompiling.
12. Stop and restart Studio. Select the named version from **Saved workflows**,
    confirm `READY_TO_RUN`, then run it again.
13. Confirm the same literal, untouched Date/Heure fields, exactly one
    **Enregistrer** action for this run and both runtime counters still at zero.

## Unverified-outcome retest

1. Start a fresh teaching session, perform at least one executable edit but no
   action that creates positive success evidence, then stop.
2. Confirm Compile remains enabled and compile succeeds.
3. Select Run locally and confirm `COMPLETED_UNVERIFIED`, never `PASSED`.

## Persistent diagnostic retest

1. Trigger a synthetic/local compile ambiguity or other safe failure.
2. Confirm the red diagnostic card appears immediately with HTTP status `422`,
   compiler stage, workflow state, redacted server message and Teaching trace
   ID.
3. Confirm **Retry compile**, **Copy diagnostics** and **Clear** are visible.
4. Wait and reload Studio; confirm the diagnostic remains visible. Trigger a
   failed retry and confirm the same persistent panel remains; a toast alone is
   not acceptable.
5. Copy it and confirm no form value, patient/query parameter, cookie, token,
   password or authentication header is present.
6. Open **Advanced details → Persistent Studio event log** and confirm the same
   redacted record; confirm it is also in the Studio terminal.
7. Correct the ambiguity and choose **Retry compile** without re-teaching.
8. Trigger another diagnostic, select **Clear**, and confirm only the visible
   card clears while the append-only event log remains.

## Ordered keyboard retest

1. Start a fresh synthetic teaching session.
2. Perform exactly: click the chooser, press `c`, press `Enter`, then click
   **Valider**.
3. Stop teaching and confirm `c` and `Enter` are two consecutive keyboard
   actions tied to the focus owner captured at each event.
4. Compile with the GPT instruction empty and confirm no locator rejection is
   raised for the now-closed listbox/dialog.
5. Run locally and then **Run again**. Confirm `PASSED` twice and both runtime
   AI counters remain zero.

## Deliberate boundaries

- Use only authorized synthetic data; automated tests never contact the real
  DPI.
- Cross-origin frame contents, closed shadow DOM and copy/paste gestures that
  expose no browser DOM event are unsupported.
- Native value-setting is a bounded final Lab fallback, not a universal editor
  compatibility claim.
