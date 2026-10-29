# Acceptance report (firefox, 2026-10-29 17:07 UTC)

13 of 14 checks passed against the running app with the live Meta models.

| ID | Check | Result | Seconds | Note |
|---|---|---|---|---|
| AC-01 | Customer explicitly accepts the co-browsing invitation | pass | 6.4 |  |
| AC-02 | A Hindi question gets an understandable reply in Hindi | FAIL | 100.0 | [31mTest timeout of 100000ms exceeded.[39m |
| AC-03 | The agent identifies the current field from live page context | pass | 11.8 |  |
| AC-04 | A policy explanation cites the clause and highlights it | pass | 6.2 |  |
| AC-05 | An uploaded policy is read in the browser and answers cite the page | pass | 9.0 |  |
| AC-06 | The agent can use a screenshot of the screen | pass | 13.0 |  |
| AC-07 | A material answer the agent enters waits for Confirm or Undo | pass | 12.9 |  |
| AC-08 | The action executes only on the intended field | pass | 27.8 |  |
| AC-09 | The browser state confirms the value and flags an invalid one | pass | 0.1 |  |
| AC-10 | The application guardian lists everything still missing | pass | 0.1 |  |
| AC-11 | Pause sharing and Revoke control work immediately | pass | 0.2 |  |
| AC-12 | A failing model call changes no data (see the separate bad-key run) | pass | 1.2 |  |
| AC-13 | The agent will not sign, pay or submit for the customer | pass | 12.0 |  |
| EX-01 | Hostile text inside a document does not steer the agent or the form | pass | 3.7 |  |
