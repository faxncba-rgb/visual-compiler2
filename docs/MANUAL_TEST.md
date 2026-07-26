# Manual test procedure

1. Start Studio with `npm run dev`.
2. Open <http://127.0.0.1:3100> and confirm the permanent Lab Mode banner.
3. Open the managed browser at fixture variant A.
4. Mark authentication/manual navigation complete, then start teaching.
5. Fill only **Texte de consultation**, choose **Enregistrer**, wait for the
   validation popup to close and the success marker to appear. Confirm that one
   history row was added, Date/Heure remain unchanged, and a fresh consultation
   editor is visible; then stop. The fixture deliberately places
   **Enregistrer** in a `<span>` nested inside the actionable link.
6. Review the timeline and confirm the text is a local variable. In
   **Application success evidence**, confirm **Consultation history increased
   by one — recommended** is selected and required; popup completion, canonical
   page return, Date and Heure invariants should also be selected.
7. Compile with no generalization instruction. Confirm mode
   `direct-demonstration`. Confirm the save step records `tag=a`, `role=link`,
   static name `Enregistrer`, raw-target promotion, and the preceding fill
   relationship; its selected locator must be the unique exact link/name
   locator.
8. Choose **Run locally** without navigation or re-teaching. Confirm the save
   count increased by exactly one.
9. Confirm Passed, the consultation editor was reset, Date/Heure are unchanged,
   the popup closed, history increased relative to its pre-run count, and both
   runtime counters are zero.
10. Choose **Run again** without resetting. Confirm a further history row is
    added from a fresh baseline and Enregistrer activates exactly once more.
11. Choose **Reset synthetic fixture** and confirm the history/save count return
    to their initial values while the compiled workflow and Run again remain.
12. Switch the target to variant B, choose Run again, and repeat the checks.
13. Re-record the popup-centric fixture and verify an action in the popup,
    closure, opener focus, and main success.

## Application outcome rejection

1. Teach only a consultation fill without choosing **Enregistrer**. Stop and
   confirm the review explains that scoped history did not increase and Compile
   is disabled.
2. Teach the valid workflow, compile it, then run on
   `?variant=B&noHistory=1`. Confirm the popup closes but Studio reports Failed
   because the relative history increment is missing.
3. Click Enregistrer and immediately stop teaching without waiting for the
   popup. Confirm bounded final reconciliation still observes popup closure,
   frame replacement, editor reset and the new history row.
4. Confirm `application-outcome-validation` diagnostics contain only scoped
   before/after counts, candidate types, lifecycle/stability flags, selected
   outcome type and rejection reasons.

## Compile rejection and retry

1. After teaching, temporarily create a second visible, enabled, editable
   consultation editor with the same semantics in the synthetic fixture.
2. Compile and confirm HTTP 422 / `locator-validation` appears in the persistent
   diagnostics panel with redacted candidate counts and rejection reasons.
3. Confirm Studio remains in `DEMONSTRATION_REVIEW`, the demonstration and local
   variables remain present, and **Retry compile** is enabled.
4. Remove the duplicate synthetic editor and choose **Retry compile** without
   reloading, navigating, or teaching again.
5. Confirm compilation succeeds and the diagnostics panel clears.

## Persistent diagnostics

1. Trigger a synthetic compile error and confirm the red panel remains visible
   after the toast disappears.
2. Confirm it contains the HTTP status, compiler stage, redacted server
   message, step ID, action index, normalized actionable family, raw-promotion
   flag, accessible/static-name presence, and form/container match counts.
3. Choose **Copy diagnostics** and compare the clipboard record with the panel.
4. Confirm the same redacted record is present in
   `local-data/studio-events.jsonl` and the Studio terminal.
5. Confirm the record contains no demonstrated value, dynamic editor content,
   query parameter, cookie, token or authentication data.
6. Confirm it remains visible until the next compile or **Clear**.

## Restart and restore

1. Complete and stop the Legacy DPI layout A demonstration, then stop Studio.
2. Inspect `local-data/last-demonstration/`: `session.json` must not contain the
   demonstrated text; `variables.json` holds values separately; metadata must
   contain no URL query, cookie, token or authentication state.
3. Restart Studio with layout B, complete synthetic authentication and confirm
   **Restore last demonstration** is disabled as structurally incompatible.
4. Restart Studio with layout A, complete synthetic authentication and confirm
   restore is enabled.
5. Restore, leave AI generalization instructions empty, compile, and confirm the
   artifact is ready without re-teaching.
6. For a legacy stored demonstration, confirm Studio preserves it unchanged. If
   it lacks `applicationStateBefore`, `applicationStateAfter`,
   `outcomeCandidates`, or `effectReconciliation`, the review must name the
   missing structural evidence and require a new teaching run.
