# Recording the demo video

Goal: a clear 3:00 video (aim for 2:50) that shows the loop **build the application by voice, get the proposed policy, have an independent agent review it, fix what it finds, ship a readiness report**. The video is the main thing judges watch, so it is worth two or three takes.

The shot list follows `docs/DEMO_SCRIPT.md`. Record it as **eight short clips**, not one long take: the full application takes minutes, and short clips are easy to redo and easy to speed up where the app is thinking.

## 1. One-time setup (15 minutes)

**Screen and browser**
- Record at **1920 x 1080**. Use the presenter view at `http://localhost:3000/presenter`: it shows the application on the left and the live model table and latency on the right. At 1512 px wide it overflows, so on a MacBook either use an external 1080p monitor or set Chrome to **80% zoom** (Cmd and minus twice) so the page lays out as if 1890 px wide.
- Use a clean Chrome profile (no extensions, bookmarks bar hidden with Cmd+Shift+B), window maximised, light theme.
- macOS: turn on **Do Not Disturb**, quit Slack, mail and anything with notifications, hide the Dock if you can.
- Allow the microphone for localhost once (click the lock icon, Microphone, Allow).

**Recorder: OBS Studio (free), https://obsproject.com**
- Settings, Video: base and output resolution 1920x1080, 30 fps. Output: MP4 or MKV, quality "High", mic and desktop on separate tracks.
- Sources: **Window Capture** (the Chrome window), **macOS Audio Capture** (app audio: Chrome, so the agent's voice is recorded cleanly), **Audio Input Capture** (your microphone).
- **Wear headphones**. The agent speaks aloud; without headphones its voice leaks into your microphone and the agent can hear itself.
- QuickTime (Cmd+Shift+5) is fine for the screen but does not capture the agent's voice without extra software; use OBS.

**Narration**: do not narrate live over the agent's replies. Record the clips with only Priya's voice and the agent's voice, then add the narrator lines afterwards (section 4). Captions carry the rest.

## 2. Before every take (5 minutes)

1. `scripts/preflight.sh` (it checks the container, the Modal review model and the speech path; add `--voice` to also run the spoken test). Fix anything it flags before recording.
2. Open `http://localhost:3000/presenter` in the demo Chrome profile. Clear site data (lock icon, Site settings, Clear data) so the opening choice shows and no old transcript or saved proposal appears.
3. Start a fresh session so the first answer is fast: Start a new policy, Accept and start co-browsing, ask one throwaway question ("What is the grace period?"), then **reload the page** and start the clip.
4. Have the sample documents ready: **Masked Aadhaar** and **Sample proposed policy (with issues)** are buttons in the app. Nothing to download.
5. Keep `docs/DEMO_SCRIPT.md` and this guide on a second screen or printed.

## 3. The eight clips

Say the **Priya** lines naturally, at normal speed, one sentence at a time, then wait for the agent to finish. If the agent mishears, stop and redo the clip.

| # | Clip (about) | Start state | Do and say | What must be visible |
|---|---|---|---|---|
| 1 | Opening (10 s) | Fresh page | Click **Start a new policy**, then **Accept and start co-browsing**. | The two-choice screen, then "Live session connected" |
| 2 | Voice fills the form (35 s) | Step 1, session live | Priya: "My name is Priya Sharma, I was born on fifth March nineteen ninety-two, I am female, I earn about eighteen lakhs a year and I do not use tobacco." Wait. Click **Confirm** on the card. **Interrupt once** while the agent is mid-sentence: say "one moment". | The second cursor filling fields, the Confirm or Undo card, the barge-in counter on the right |
| 3 | Document and privacy (15 s) | Same page | Click **Masked Aadhaar**. Show the panel (what the model sees, blurred, next to the result). The **discrepancy card** appears because the card's name differs from the typed one: click **Keep mine**. | Blurred copy, pixelated result, the discrepancy card |
| 4 | Hindi and the step gate (15 s) | Step 1 | Click **हिंदी**. Priya asks: "मासिक प्रीमियम के लिए ग्रेस पीरियड कितना होता है?" The terms drawer opens on **Clause 2**. Close it, switch back to **English**, click **Continue to Step 2** with fields missing. | Hindi answer, highlighted clause, the "Finish this step" box |
| 5 | Step 5 (10 s) | Prepare **off camera**: fill the whole application (typing is fine), stop on step 5 | Show the **Application check**, click **Download proposed policy (draft)**, then **Review it with Integrity Guardian**. | The check list, the download, the tab change and the **different voice** saying who it is |
| 6 | Guardian review (60 s) | Guardian tab | Click **Sample proposed policy (with issues)**. Point out the black bars. Click **Run Integrity Guardian** (about 10 to 20 seconds; this part is sped up in editing). Read the findings with the cursor (sum assured, premium, grace 10 days, suicide 24 months, two-year Section 45, no nomination). Priya asks: "What happens if I miss a payment in month two?" | The document with black bars, findings with page buttons, the answer citing page 3, the model usage table |
| 7 | Fix and review again (20 s) | Guardian | Click **Fix in the application** on the premium mismatch, show the step, go back to the Guardian tab, click **Review again**. | "Reviews: #1 N issues, #2 M issues" |
| 8 | Readiness report (15 s) | Guardian | Scroll to **Readiness report**, click **Download the report**. | The report numbers and the "you decide" line |

Tips
- Do clips 5 to 8 in one go from step 5; they connect.
- If the review fails, check the Modal endpoint (`scripts/preflight.sh`); switching to hosted Spark is one line in `omni_browse/.env.local` (`GUARDIAN_PROVIDER="spark"`) and a container restart. Say nothing about it in the video.
- Leave a clean 2 seconds of stillness before and after each clip so cuts are easy.

## 4. Edit (CapCut, iMovie or DaVinci Resolve, all free)

1. Cut the clips in order, trim dead air, **speed up the review wait and any "thinking" to 2x to 4x** with a small "sped up" caption.
2. **Captions** (large, bottom): one per clip, from the "What must be visible" column; keep a small corner caption **"Built during the hackathon, sample documents, fictional insurer"** for the whole video.
3. **Narration**: record one voice-over pass (QuickTime, File, New Audio Recording, with headphones on) using the lines in `docs/DEMO_SCRIPT.md`, then place them over the quiet moments. Lower the music (if any) to 10%.
4. **Opening card (3 s)**: logo plus "Voice co-browsing and an independent policy reviewer for term-life applications".
5. **End card (5 s)**: "Muse Spark, Muse Spark Open, Muse Voice Transcribe, Muse Wonder, SAM 3.1, Muse Image" with one line each (copy from the architecture tab), the repository link, and "You decide: declarations, signature and payment stay with you."
6. Length: **under 3:00**. The rule is a three-minute video; aim for 2:50.

## 5. Export and submit

- Export **MP4 (H.264), 1920x1080, 30 fps**, under 500 MB.
- Upload to YouTube as **Unlisted** (or Vimeo, or Google Drive with "anyone with the link"). Open the link in a **private window** to confirm it plays without signing in.
- Put the link in the submission form together with the public repository link, and list everyone who worked on the project.

## 6. Say and avoid

Say: "blurred copies go to Meta, the original stays in your browser", "possible issue", "sample documents, fictional insurer", "the agent never signs or pays".

Avoid: "no data reaches Meta" (name, date of birth, address and PIN on the redacted image do), "illegal" or "wrong" about a document, anything about whether a claim would be paid, real names or IDs, and showing `.env.local` or any key on screen.

## 7. If something goes wrong on the day

| Problem | Do this |
|---|---|
| Agent does not answer | Reload, start a new session, ask a throwaway question first |
| Voice not heard | Check the OBS mic meter and the Chrome microphone lock icon; headphones on |
| Review shows an error | Run `scripts/preflight.sh`; check Modal billing; or switch the provider to `spark` |
| Hindi reply is in English | Switch language, wait four seconds, ask again |
| Layout overflows | Chrome zoom 80% (or a 1080p display) and reload |
| Out of time in edit | Cut clip 4 (Hindi) first, then the document close-up in clip 3 |

A recorded full run of the script by the test suite is in `docs/rehearsal/rehearsal.webm` (local only) as a reference for pacing; its report is `docs/rehearsal-report.md`.
