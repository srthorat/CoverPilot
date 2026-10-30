# Load and capacity test

Measured on 30 Oct 2026 against the Docker image on one machine (Docker Desktop, 5 CPU cores and 23 GB given to Docker, Apple silicon), with the live Meta models. The load client ran in a separate throwaway container from the same image, so its CPU is not charged to the container under test. A few hundred live Meta model calls were spent in total (voice turns and Guardian reviews).

## The short version

- **One container carries 8 live voice conversations.** With 8 at once every question is answered, at a median of 6 to 8 seconds for the first words of the answer (the first spoken sound, an acknowledgement, comes at about 3 to 5 seconds).
- **10 at once still works. 12 at once does not:** the questions reach the agent and are never answered, even after 150 seconds. So the agent now refuses a ninth conversation with a clear "busy, try again in a minute" message (`MAX_SESSIONS`, default 8). With the limit on, 12 visitors at once gave 8 normal conversations and 4 polite refusals; without it, the same 12 got nothing.
- **Everything else is far from its limit:** the page served 214 requests a second with 100 at once, the encrypted vault and the rate limits behaved under hammering, and Guardian reviews succeeded 6 at once (the slowest took 15 seconds).
- **Not found:** the root cause of the stall at 12. The evidence is under "What breaks first" below; the limit is a measured safe ceiling, not an explanation.

## What to say if judges all click at once

> The voice assistant takes 8 conversations at a time on this server. If it is full you get a message saying so and can try again in a minute; the page, the document review and saving a draft keep working for everyone. A slot frees the moment someone clicks Disconnect, or within about a minute after they close the tab.

If more simultaneous callers are expected, run more containers behind a load balancer that keeps each visitor on one container (for example Caddy `lb_policy ip_hash`), each with its own `MAX_SESSIONS`. Typing questions also uses a voice session (the text goes over the same connection), so there is no separate text capacity.

## Voice conversations

Each session connects over WebRTC, streams silent microphone audio (so the agent runs voice-activity detection and holds a Meta speech-recognition socket exactly as in a live call), and sends text questions like the web app does. All sessions send their question at the same moment, which is harsher than real visitors. Before the fixes below:

| Sessions | Questions answered | First words of the answer, median / slowest | First spoken sound, median | Container CPU (peak, of 5 cores) | Container memory (peak) |
|---|---|---|---|---|---|
| 1 | 2 of 2 | 5.7 s / 5.7 s | 3.4 s | 37% | 269 MB |
| 3 | 6 of 6 | 5.7 s / 12.0 s | 3.3 s | 62% | 326 MB |
| 5 | 10 of 10 | 6.6 s / 9.3 s | 3.0 s | 93% | 455 MB |
| 8 | 16 of 16 | 8.4 s / 18.7 s | 5.3 s | 126% | 644 MB |
| 10 | 10 of 10 | 8.1 s / 11.3 s | 4.6 s | not sampled | not sampled |
| 12 | 0 of 12 (three runs, one also with a 150 s wait) | none | none | 130% to 150% | 770 MB |

One run of 12 on a freshly started container did answer all 12 (median 9.4 s, slowest 19.8 s), and every later run of 12 on that container failed. 12 is therefore past the edge, not a clean cliff at exactly 12.

With the limit on (default 8), 12 sessions offered at once: 8 connected and all 8 answered (median 5.8 s, slowest 9.6 s); the other 4 got the 503 "busy" answer. The browser check `e2e/capacity.spec.ts` confirms a real visitor sees the message when 8 are connected, and gets in once they leave.

Cost of a session (measured): about 11% of one core while connected and silent, about 20 to 25 MB of memory while live, and roughly 170 to 250 MB for the agent process itself with nothing running.

### What breaks first

The single asyncio event loop that every session shares. Evidence, not proof:

- The questions arrive (the agent logs each message) but none reaches the model stage (`[turn] user` is never logged), so the stall is inside the audio and frame pipeline, before any call to Meta.
- The failure does not depend on how many sessions are connected (12 connected with 1 or 6 asking worked, slowly), only on how many ask at once.
- A task dump taken during a stall (`kill -USR2`, see below) shows 15 queued frame deliveries that had not started and none of the model-call or speech-output tasks that a healthy run shows, while the event loop thread was at about 45% to 55% CPU, so it is not a plain CPU limit. About 220 threads (speech-model threads, encoder threads, per-session thread pools) share one Python interpreter lock with that loop, which is the likely reason; I could not confirm it without a profiler that sees the lock.
- Speech recognition limits on Meta's side were not the cause: at 12 sessions only 1 of 12 speech sockets timed out opening, and the other 11 had working speech recognition and still stalled. Other work was using the same Meta key at the time, so I could not rule out that load on Meta's side added to it.
- Tried and removed: swapping the per-frame microphone resampler (PyAV) for a faster one (soxr) did not change event-loop CPU (44.6% against 46.7% at 8 sessions), so it was not shipped.

## Memory over time (soak)

Sessions opening and closing for 5 minutes, 3 at a time, with a vault save, read and delete every 8 seconds alongside.

| | Before the fix | After the fix |
|---|---|---|
| Sessions served | 57 in 5.5 min | 87 in 5.5 min |
| Agent memory | climbed to 700 to 770 MB, dropping only when Python happened to collect | flat, 206 to 321 MB |
| Agent threads | rose to 126 | 21 to 41 |
| Open files | 23 to 34 | 21 to 26 |
| Web server memory | 127 to 131 MB | 140 to 151 MB, flat |
| Questions answered | 27 of 30 | 45 of 45 |
| Vault folder | 54 files, unchanged | 55 files, unchanged (42 save-read-delete rounds, no unexpected result) |

Cause: a finished session leaves objects that refer to each other (the pipeline, two speech-detection ONNX models of about 15 MB each, their thread pools). Python frees those only at its next full collection and the allocator keeps what it freed, so memory grew about 20 MB per finished session until a lucky collection. Not a leak (a probe that creates and drops those models in a loop stays flat after the first import), but it would have grown with the number of visitors. Fixed by collecting and trimming 3 seconds after any session ends (`coverpilot/diag.py`, `schedule_release`) plus `MALLOC_ARENA_MAX=2` (`docker/entrypoint.sh`).

## Page, vault, limits

`scripts/loadtest/http_routes.mjs`: 26 checks, no 5xx anywhere.

- `GET /` 100 at once: all 200, median 247 ms, 95th percentile 448 ms, 214 requests a second.
- `/api/ice-servers`: 5 a minute per address (6th gets 429 with `Retry-After`), cross-site 403, foreign `Origin` 403, `Origin: null` 403 (not 500); a browser call mints a Cloudflare credential, a plain call mints nothing.
- Vault: valid save 200, invalid JSON 400, id outside the alphabet 400, path in the id 404, over 200 KB 413, replacing someone else's code without the token 403, delete without the token 403, 30 a minute then 429.
- Size caps: Guardian over 1 MB, OCR and SAM over 12 MB, speech over 20 KB all 413 before any model call; garbage bodies give 4xx.
- Guardian concurrent reviews of the planted-issues sample (live review model): 1 at a time 8.6 s; 3 at once median 11.4 s, slowest 12.2 s; 6 at once median 14.2 s, slowest 14.9 s; all succeeded. The route allows 6 reviews a minute per address.

## Problems found and fixed

1. **The vault rate limit could be bypassed, and was shared by everyone.** It trusted the `X-Forwarded-For` header, which any caller can forge, so 60 of 60 requests with a different forged address got through; and without that header every caller shared one bucket. The vault now uses the same guard as the other routes (the socket address stamped by the server, the forwarded address only behind a trusted proxy, cross-site requests refused). After the fix 56 of 60 forged requests get 429. Tests in `src/lib/rate-limit.test.ts`; `scripts/loadtest/vault_limiter.mjs` repeats the check.
2. **The vault had no upper bound on stored proposals** (entries expire after 14 days but a flood could fill the disk at up to 200 KB each). It now refuses new codes with a 503 at 2000 stored (`MAX_BLOBS`), still allows replacing an existing one, and the expiry sweep makes room. Test in `src/lib/vault-store.test.ts`. A full vault of 5000 entries cost 18 ms per save, so the per-save directory sweep is not a problem at this size.
3. **No limit on live conversations, and past about 10 every caller hung.** Added `MAX_SESSIONS` (default 8) with a 503 and a plain message, a capacity endpoint (`/voice-agent/api/capacity`) so the web app can say "busy" before opening a connection (the voice library hides the HTTP status), and the browser check above. A renegotiation of a running session is never refused. Tests in `voice-agent-py/tests/test_capacity.py` and `src/lib/voice-busy.test.ts`.
4. **Memory grew with every session served** (see the soak). Fixed as above.

Added for operations: `kill -USR2 <agent pid>` writes a summary of every pending asyncio task (grouped by where it waits, code positions only, no message text) and every thread's stack to the log without stopping anything. The image has no `kill`, so in a container: `docker exec <name> /app/voice-agent-py/.venv/bin/python -c "import os,signal;os.kill(<pid>, signal.SIGUSR2)"` (the agent pid is shown by `scripts/loadtest/thread_cpu.py`).

## Limits of this test (read before quoting a number)

- The microphone was silent. Real speech adds voice-activity and turn-detection work, recognition traffic and spoken replies, so a real call costs more than a silent one. The limit of 8 was measured with all sessions asking at once and the agent answering by voice, which is the heavier part, but real speech was not used.
- The slow part of an answer is the Meta model, not this server: median 5.7 s for one session. The load test shows how much a crowd adds on top of that (about 3 s at 8 sessions), not the model's own speed.
- One container on one machine. A different CPU, more cores or a different Docker setup will move the ceiling; the 8 is a safe default, not a guarantee. Raise `MAX_SESSIONS` only after repeating the ramp.
- Other forks and tests shared the Meta API key during parts of the run, so some slow turns may include contention on Meta's side.
- Browsers were not used for the ramps (a WebRTC client in Python stands in for them), except the capacity check, which uses a real Chromium.
- A visitor who closes the tab without clicking Disconnect keeps their slot for up to about a minute, until the server notices the connection is gone.
- Everyone behind one address (a shared office or judging-room network) shares one set of per-address rate limits, for example 6 Guardian reviews a minute for the whole room.
- 3 of 30 questions in the first soak got no text answer; the second soak answered 45 of 45. Not explained.

## Run it again

```bash
docker build -t coverpilot:local . && docker run -d --name coverpilot -p 3000:3000 \
  --add-host host.docker.internal:host-gateway \
  -v "$PWD/omni_browse/.env.local:/app/omni_browse/.env.local:ro" coverpilot:local

BASE_URL=http://localhost:3000 node scripts/loadtest/http_routes.mjs             # pages, vault, limits, size caps (no model calls)
BASE_URL=http://localhost:3000 node scripts/loadtest/vault_limiter.mjs           # forged X-Forwarded-For must not help
BASE_URL=http://localhost:3000 LEVELS=1,3,6 node scripts/loadtest/guardian_load.mjs      # live review model, 10 calls
python3 scripts/loadtest/voice_ramp.py --container coverpilot --image coverpilot:local --port 3000 --levels 1,3,5,8   # live Meta models
python3 scripts/loadtest/voice_ramp.py --container coverpilot --image coverpilot:local --port 3000 --soak-minutes 5 --soak-sessions 3
CLIENT_IMAGE=coverpilot:local BASE_URL=http://localhost:3000 npx playwright test e2e/capacity.spec.ts   # busy message in a real browser
```

To see what limits a bigger ramp, start the container with `-e MAX_SESSIONS=100`, and put it back afterwards. `scripts/loadtest/leak_probe.py`, `fill_vault.py` and `thread_cpu.py` are the helpers used above (copy them into the container with `docker cp`).
