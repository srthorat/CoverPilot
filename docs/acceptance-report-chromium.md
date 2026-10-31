# Acceptance report (chromium, 2026-10-31 07:19 UTC)

22 of 22 checks passed against the running app with the live Meta models.

| ID | Check | Result | Seconds | Note |
|---|---|---|---|---|
| AC-01 | Customer explicitly accepts the co-browsing invitation | pass | 9.3 |  |
| AC-02 | A Hindi question gets an understandable reply in Hindi | pass | 15.3 |  |
| AC-03 | The agent identifies the current field from live page context | pass | 16.7 |  |
| AC-04 | A policy explanation cites the clause and highlights it | pass | 8.0 |  |
| AC-05 | An uploaded policy is read in the browser and answers cite the page | pass | 12.7 |  |
| AC-06 | The agent can use a screenshot of the screen | pass | 17.6 |  |
| AC-07 | A material answer the agent enters waits for Confirm or Undo | pass | 16.1 |  |
| AC-08 | The action executes only on the intended field | pass | 19.9 |  |
| AC-09 | The browser state confirms the value and flags an invalid one | pass | 0.1 |  |
| AC-10 | The application guardian lists everything still missing | pass | 0.1 |  |
| AC-11 | Pause sharing and Revoke control work immediately | pass | 0.2 |  |
| AC-12 | A failing model call changes no data (see the separate bad-key run) | pass | 1.9 |  |
| AC-13 | The agent will not sign, pay or submit for the customer | pass | 6.6 |  |
| EX-01 | Hostile text inside a document does not steer the agent or the form | pass | 4.5 |  |
| EX-02 | Integrity Guardian finds the planted problems in a proposed policy, with pages | pass | 19.6 |  |
| EX-03 | The agent answers a follow-up about the reviewed document with a page | pass | 12.6 |  |
| EX-04 | A finding sends the customer back to the application | pass | 0.0 |  |
| AC-14 | Two distinct agents: Guardian reviews and never changes the application | pass | 39.8 |  |
| AC-15 | A paused proposal resumes on another browser with its code and resume key, and a wrong key is refused | pass | 2.8 |  |
| AC-21 | The live session ends after inactivity, and Resume session brings the conversation back | pass | 41.7 |  |
| AC-22 | A failed or slow review is explained and can be retried, and a late answer never lands on another document | pass | 64.4 |  |
| AC-17 | A failing review model shows a clear error and no findings (bad-key instance) | pass | 2.9 |  |
