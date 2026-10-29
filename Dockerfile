# syntax=docker/dockerfile:1.7
#
# CoverPilot in one image: the Next.js app (omni_browse) and the Python Pipecat voice agent
# (voice-agent-py). Next listens on :3000 and proxies /voice-agent/* to the agent on
# 127.0.0.1:7860 inside the container, so only :3000 is published.
#
#   docker build -t coverpilot .
#   docker run --rm -p 3000:3000 \
#     -v "$PWD/omni_browse/.env.local:/app/omni_browse/.env.local:ro" \
#     -v coverpilot-data:/app/voice-agent-py/data \
#     coverpilot
#
# Keys are never baked into the image. Pass them at run time, either by mounting the env file as
# above (quotes are handled) or as plain environment variables (-e META_MODEL_API_KEY=...,
# GOOGLE_TTS_API_KEY, TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL).
#
# WebRTC media is UDP. Behind NAT or a cloud firewall set TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL
# so audio relays through TURN, or run with --network host on Linux.

FROM node:22-bookworm-slim AS web-build
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
WORKDIR /app/omni_browse
COPY omni_browse/package.json omni_browse/pnpm-lock.yaml omni_browse/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY omni_browse/ ./
RUN pnpm build && pnpm prune --prod


FROM python:3.12-slim-bookworm AS runtime
# Node runtime for server.mjs (the app's dependencies come from the build stage).
COPY --from=web-build /usr/local/bin/node /usr/local/bin/node
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv

RUN useradd --create-home --uid 10001 app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=localhost \
    AGENT_PORT=7860 \
    VOICE_AGENT_URL=http://127.0.0.1:7860

WORKDIR /app/voice-agent-py
COPY voice-agent-py/pyproject.toml voice-agent-py/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY --chown=app:app voice-agent-py/ ./
RUN mkdir -p data && chown -R app:app /app/voice-agent-py

COPY --chown=app:app --from=web-build /app/omni_browse /app/omni_browse
COPY --chown=app:app docker/ /app/docker/
RUN chmod +x /app/docker/entrypoint.sh

USER app
VOLUME ["/app/voice-agent-py/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["python", "/app/docker/healthcheck.py"]

ENTRYPOINT ["/app/docker/entrypoint.sh"]
