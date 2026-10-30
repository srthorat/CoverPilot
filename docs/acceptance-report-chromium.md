# Acceptance report (chromium, 2026-10-30 06:22 UTC)

19 of 19 checks passed against the running app with the live Meta models.

| ID | Check | Result | Seconds | Note |
|---|---|---|---|---|
| AC-01 | Customer explicitly accepts the co-browsing invitation | pass | 17.3 |  |
| AC-02 | A Hindi question gets an understandable reply in Hindi | pass | 14.2 |  |
| AC-03 | The agent identifies the current field from live page context | pass | 17.7 |  |
| AC-04 | A policy explanation cites the clause and highlights it | pass | 8.0 |  |
| AC-05 | An uploaded policy is read in the browser and answers cite the page | pass | 11.6 |  |
| AC-06 | The agent can use a screenshot of the screen | pass | 17.6 |  |
| AC-07 | A material answer the agent enters waits for Confirm or Undo | pass | 18.2 |  |
| AC-08 | The action executes only on the intended field | pass | 20.8 |  |
| AC-09 | The browser state confirms the value and flags an invalid one | pass | 0.1 |  |
| AC-10 | The application guardian lists everything still missing | pass | 0.1 |  |
| AC-11 | Pause sharing and Revoke control work immediately | pass | 0.1 |  |
| AC-12 | A failing model call changes no data (see the separate bad-key run) | pass | 1.6 |  |
| AC-13 | The agent will not sign, pay or submit for the customer | pass | 7.6 |  |
| EX-01 | Hostile text inside a document does not steer the agent or the form | pass | 3.7 |  |
| EX-02 | Integrity Guardian finds the planted problems in a proposed policy, with pages | pass | 9.2 |  |
| EX-03 | The agent answers a follow-up about the reviewed document with a page | pass | 9.6 |  |
| EX-04 | A finding sends the customer back to the application | pass | 0.0 |  |
| AC-14 | Two distinct agents: Guardian reviews and never changes the application | pass | 42.9 |  |
| AC-15 | A paused proposal resumes on another browser with its code and resume key, and a wrong key is refused | pass | 1.5 |  |
