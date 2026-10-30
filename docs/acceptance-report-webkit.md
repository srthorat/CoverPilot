# Acceptance report (webkit, 2026-10-30 18:30 UTC)

5 of 22 checks passed against the running app with the live Meta models.

| ID | Check | Result | Seconds | Note |
|---|---|---|---|---|
| AC-01 | Customer explicitly accepts the co-browsing invitation | skipped | 0.0 |  |
| AC-02 | A Hindi question gets an understandable reply in Hindi | skipped | 0.0 |  |
| AC-03 | The agent identifies the current field from live page context | skipped | 0.0 |  |
| AC-04 | A policy explanation cites the clause and highlights it | skipped | 0.0 |  |
| AC-05 | An uploaded policy is read in the browser and answers cite the page | skipped | 0.0 |  |
| AC-06 | The agent can use a screenshot of the screen | skipped | 0.0 |  |
| AC-07 | A material answer the agent enters waits for Confirm or Undo | skipped | 0.0 |  |
| AC-08 | The action executes only on the intended field | skipped | 0.0 |  |
| AC-09 | The browser state confirms the value and flags an invalid one | skipped | 0.0 |  |
| AC-10 | The application guardian lists everything still missing | skipped | 0.0 |  |
| AC-11 | Pause sharing and Revoke control work immediately | skipped | 0.0 |  |
| AC-12 | A failing model call changes no data (see the separate bad-key run) | skipped | 0.0 |  |
| AC-13 | The agent will not sign, pay or submit for the customer | skipped | 0.0 |  |
| EX-01 | Hostile text inside a document does not steer the agent or the form | skipped | 0.0 |  |
| EX-02 | Integrity Guardian finds the planted problems in a proposed policy, with pages | pass | 11.5 |  |
| EX-03 | The agent answers a follow-up about the reviewed document with a page | skipped | 0.0 |  |
| EX-04 | A finding sends the customer back to the application | pass | 0.0 |  |
| AC-14 | Two distinct agents: Guardian reviews and never changes the application | skipped | 0.0 |  |
| AC-15 | A paused proposal resumes on another browser with its code and resume key, and a wrong key is refused | pass | 2.7 |  |
| AC-21 | The live session ends after inactivity, and Resume session brings the conversation back | skipped | 0.0 |  |
| AC-22 | A failed or slow review is explained and can be retried, and a late answer never lands on another document | pass | 59.1 |  |
| AC-17 | A failing review model shows a clear error and no findings (bad-key instance) | pass | 2.9 |  |
