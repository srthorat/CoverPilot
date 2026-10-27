#!/usr/bin/env bash
# Start the CoverPilot demo locally: Python voice agent (.venv) + Next.js app.
# Usage: ./run-local.sh            (Ctrl+C stops both)
# Keys and TURN settings are read from omni_browse/.env.local by both processes.
set -euo pipefail
cd "$(dirname "$0")"

APP_PORT="${PORT:-3004}"
AGENT_PORT="${AGENT_PORT:-7860}"
PY=voice-agent-py/.venv/bin/python

if [ ! -x "$PY" ]; then
  echo "No .venv in voice-agent-py. Create it once with:  cd voice-agent-py && uv sync" >&2
  exit 1
fi
if [ ! -d omni_browse/node_modules ]; then
  echo "No node_modules in omni_browse. Run once:  cd omni_browse && pnpm install" >&2
  exit 1
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

( cd voice-agent-py && exec "$PWD/.venv/bin/python" bot.py -t webrtc --host 0.0.0.0 --port "$AGENT_PORT" \
    --allowed-origins "http://localhost:$APP_PORT" "http://127.0.0.1:$APP_PORT" ) &

( cd omni_browse && PORT="$APP_PORT" VOICE_AGENT_URL="http://127.0.0.1:$AGENT_PORT" exec node server.mjs ) &

echo "CoverPilot: app http://localhost:$APP_PORT   voice agent http://localhost:$AGENT_PORT"
wait
