#!/usr/bin/env bash
# Runs the end-to-end acceptance checks against the Docker image on :3000, and AC-12 (a failing
# model call changes no data) against a second instance that has an invalid Meta key.
#   scripts/run-acceptance.sh            Chromium      BROWSER=firefox scripts/run-acceptance.sh
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE="${IMAGE:-coverpilot:local}"
docker rm -f coverpilot-badkey >/dev/null 2>&1 || true
docker run -d --name coverpilot-badkey -p 3001:3000 -e META_MODEL_API_KEY=invalid-key-for-failure-test "$IMAGE" >/dev/null
trap 'docker rm -f coverpilot-badkey >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 40); do curl -sf -o /dev/null http://localhost:3001 && break; sleep 2; done
cd omni_browse
FAILURE_URL=http://localhost:3001 BASE_URL="${BASE_URL:-http://localhost:3000}" pnpm e2e
