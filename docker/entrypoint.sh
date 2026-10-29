#!/usr/bin/env bash
# Runs the Python voice agent and the Next.js app in one container. If either process exits the
# other is stopped and the container exits, so the orchestrator (docker restart policy) restarts both.
set -uo pipefail

AGENT_PORT="${AGENT_PORT:-7860}"

(cd /app/voice-agent-py && exec /app/voice-agent-py/.venv/bin/python bot.py -t webrtc --host 127.0.0.1 --port "$AGENT_PORT") &
agent=$!
(cd /app/omni_browse && exec node server.mjs) &
web=$!

stop() { kill -TERM "$agent" "$web" 2>/dev/null || true; }
trap stop TERM INT

wait -n "$agent" "$web"
code=$?
stop
wait
exit "$code"
