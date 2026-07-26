# Manual test procedure

1. Start Studio with `npm run dev`.
2. Open <http://127.0.0.1:3100> and confirm the permanent Lab Mode banner.
3. Open the managed browser at fixture variant A.
4. Mark authentication/manual navigation complete, then start teaching.
5. Fill only **Texte de consultation**, choose **Enregistrer**, wait for the
   validation popup to close and the success marker to appear, then stop.
6. Review the timeline and confirm the text is a local variable.
7. Compile with no generalization instruction. Confirm mode
   `direct-demonstration`.
8. Choose **Run locally** without running animation first.
9. Confirm Passed, Date/Heure unchanged, save count one, popup closed, and both
   runtime counters zero.
10. Switch the target to variant B, choose Run again, and repeat the checks.
11. Re-record the popup-centric fixture and verify an action in the popup,
    closure, opener focus, and main success.
