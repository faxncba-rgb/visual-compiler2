# Manual test procedure

1. Start Studio with `npm run dev`.
2. Open <http://127.0.0.1:3100> and confirm the permanent Lab Mode banner.
3. Open the managed browser at fixture variant A.
4. Mark authentication/manual navigation complete, then start teaching.
5. Fill only **Texte de consultation**, choose **Enregistrer**, wait for the
   validation popup to close and the success marker to appear. Confirm that one
   history row was added, Date/Heure remain unchanged, and a fresh consultation
   editor is visible; then stop.
6. Review the timeline and confirm the text is a local variable.
7. Compile with no generalization instruction. Confirm mode
   `direct-demonstration`.
8. Choose **Run locally** without navigation or re-teaching. Confirm the save
   count increased by exactly one.
9. Confirm Passed, the consultation editor received the local value, Date/Heure
   are unchanged, the popup closed, and both runtime counters are zero.
10. Choose **Reset synthetic fixture** and confirm the history/save count return
    to their initial values while the compiled workflow and Run again remain.
11. Switch the target to variant B, choose Run again, and repeat the checks.
12. Re-record the popup-centric fixture and verify an action in the popup,
    closure, opener focus, and main success.

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
