# Deploying to a public host (EC2 or any Docker host)

The production stack in `deploy/` runs one CoverPilot container (web app and voice agent together) behind Caddy, which gets and renews the HTTPS certificate automatically. HTTPS is required because browsers only allow the microphone on secure pages.

## What you need

- A Linux host with a public IP (EC2 Ubuntu 22.04 or 24.04 works; `t3.large` or similar for amd64, or a Graviton type with `PLATFORM=linux/arm64`) and about 20 GB of disk.
- Docker with the compose plugin on that host: `curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER`, then log out and in.
- Docker on the machine you deploy from (the image is built locally and sent over SSH, no registry).
- Your keys in `omni_browse/.env.local` (copy `omni_browse/.env.example` and fill it in; the file is git-ignored). At minimum `META_MODEL_API_KEY` and `GOOGLE_TTS_API_KEY`; a `TURN_*` relay (see below); the `GUARDIAN_*` values only if you use Muse Spark Open.

## Network (EC2 security group)

| Port | Purpose |
|---|---|
| TCP 22 | SSH for the deploy (restrict to your IP) |
| TCP 80 | Caddy, certificate challenge and redirect |
| TCP 443 | Caddy, the app |

No inbound UDP is needed: voice audio is relayed through the TURN server configured in `TURN_URLS`, `TURN_USERNAME` and `TURN_CREDENTIAL`. Without a TURN relay, WebRTC audio usually fails behind NAT and cloud firewalls (a first connection failure also happens occasionally; the browser retries once). The host needs outbound access to `api.meta.ai`, Google Cloud, your TURN server and, if used, the Modal endpoint. Ports 3000 and 7860 are not published; only Caddy is reachable from outside.

## Deploy

```bash
deploy/deploy.sh ubuntu@<public-ip> <public-ip>        # served at https://<public-ip>.sslip.io
deploy/deploy.sh my-ec2-alias app.example.com           # or your own domain (point DNS at the host first)
# PLATFORM=linux/arm64   for Graviton
# SSH_OPTS="-i key.pem"  for a key file
# a third argument selects a different env file (default omni_browse/.env.local)
```

The script builds the image for the target platform, streams it to the host, copies the compose file, the Caddyfile and your env file (to `~/coverpilot/secrets/.env.local`, mode 600), writes `PUBLIC_HOST` and the image tag to `~/coverpilot/.env`, and runs `docker compose up -d`. A bare IP becomes `<ip>.sslip.io` so Caddy can get a real certificate without a domain. The first request can take a few seconds while the certificate is issued.

Check it:

```bash
ssh ubuntu@<public-ip> 'cd coverpilot && docker compose ps && docker compose logs --tail 50 coverpilot'
curl -sI https://<public-ip>.sslip.io | head -1       # expect 200
```

Open the site, pick "Start a new policy", accept the session and speak. The presenter view is at `/presenter`.

## What the compose file sets

- `TRUST_PROXY=true` so the per-visitor rate limits use the address Caddy forwards. Without it every visitor would share one bucket.
- The env file is mounted read-only at `/app/omni_browse/.env.local`; no key is baked into the image.
- The `coverpilot-data` volume (`/app/voice-agent-py/data`) holds `memory.sqlite` (remembered facts per customer id), `cases.jsonl` (underwriter hand-offs with identity numbers masked) and `vault/` (encrypted paused proposals; ciphertext only, removed after 14 days). It survives updates. Back it up if you care about it; there is no personal data of value in a demo.

## Spark Open on Modal (optional)

Set `GUARDIAN_PROVIDER=spark-open`, `GUARDIAN_OPEN_BASE_URL`, `GUARDIAN_OPEN_API_KEY` (for Modal proxy auth: `<token-id>.<token-secret>`) and `GUARDIAN_OPEN_MODEL` in the env file. If it is selected and the endpoint is unreachable, over its limit or out of credit, the Guardian review shows an error; it does not switch to hosted Spark. A cold start can take a minute (the request waits up to 240 seconds). Leave `GUARDIAN_PROVIDER=spark` to use the Meta Model API instead.

## Demo build and own files

The image is built with the sample-documents-only demo behaviour. The controls for picking your own ID image or policy PDF are compiled out unless `NEXT_PUBLIC_ALLOW_OWN_FILES=true` is set when the app is built. The `Dockerfile` does not expose it as a build argument yet; to enable it, add `ARG NEXT_PUBLIC_ALLOW_OWN_FILES` and `ENV NEXT_PUBLIC_ALLOW_OWN_FILES=$NEXT_PUBLIC_ALLOW_OWN_FILES` before `RUN pnpm build` in the web-build stage. The privacy design for those files was tuned on the bundled sample layouts only.

## Things to know before the link is public

- Rate limits are in memory per container, so they reset on restart. They slow abuse of the keys; they are not authentication.
- TURN credentials are served to every visitor of the site (the browser needs them). Use relay-only, low-quota credentials.
- Capacity is unmeasured: one container runs one voice pipeline per session. Do not assume it scales to many simultaneous callers.
- Rotate any key that was ever pasted into a chat or a log.

## Update or remove

```bash
deploy/deploy.sh ubuntu@<public-ip> <public-ip>        # same command again rebuilds and restarts
ssh ubuntu@<public-ip> 'cd coverpilot && docker compose down'            # stop, keep data
ssh ubuntu@<public-ip> 'cd coverpilot && docker compose down -v'         # stop and delete the data volumes
```
