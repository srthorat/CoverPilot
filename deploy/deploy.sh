#!/usr/bin/env bash
# Deploy CoverPilot to a Docker host over SSH: no registry needed.
#
#   deploy/deploy.sh <ssh-target> <public-ip-or-hostname> [path/to/.env.local]
#
#   deploy/deploy.sh ubuntu@203.0.113.10 203.0.113.10     # a bare IP (203.0.113.0/24 is the documentation range)
#   deploy/deploy.sh my-ec2-alias app.example.com
#
# - A bare IP is served as <ip>.sslip.io so Caddy can get a real certificate without a domain.
# - The host needs Docker with the compose plugin and ports 80 and 443 open (plus SSH).
# - The image is built for linux/amd64 (most EC2 types). For Graviton (arm64) set PLATFORM=linux/arm64.
# - Extra ssh/scp options (for example -i key.pem) go in SSH_OPTS; extra docker build flags
#   (for example --build-arg NEXT_PUBLIC_ALLOW_OWN_FILES=true) go in BUILD_ARGS.
set -euo pipefail

TARGET="${1:?usage: deploy.sh <ssh-target> <public-ip-or-hostname> [env-file]}"
HOST_ARG="${2:?usage: deploy.sh <ssh-target> <public-ip-or-hostname> [env-file]}"
ENV_FILE="${3:-omni_browse/.env.local}"
PLATFORM="${PLATFORM:-linux/amd64}"
TAG="coverpilot:${PLATFORM#linux/}"
REMOTE_DIR="${REMOTE_DIR:-coverpilot}"
SSH_OPTS="${SSH_OPTS:-}"

cd "$(dirname "$0")/.."
[ -f "$ENV_FILE" ] || { echo "env file not found: $ENV_FILE" >&2; exit 1; }

if [[ "$HOST_ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then PUBLIC_HOST="${HOST_ARG}.sslip.io"; else PUBLIC_HOST="$HOST_ARG"; fi

# shellcheck disable=SC2086
ssh_() { ssh $SSH_OPTS "$TARGET" "$@"; }

echo "==> checking the host"
ssh_ 'docker compose version >/dev/null 2>&1' || {
  echo "Docker with the compose plugin is not installed on $TARGET." >&2
  echo "Install it first, for example on Ubuntu:  curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker \$USER  (then log out and in)" >&2
  exit 1
}

echo "==> building $TAG"
# shellcheck disable=SC2086
docker build --platform "$PLATFORM" -t "$TAG" ${BUILD_ARGS:-} .

echo "==> sending the image (this is a few hundred MB compressed)"
docker save "$TAG" | gzip | ssh_ "gunzip | docker load"

echo "==> sending the stack and keys"
ssh_ "mkdir -p $REMOTE_DIR/secrets && chmod 700 $REMOTE_DIR/secrets"
# shellcheck disable=SC2086
scp $SSH_OPTS deploy/docker-compose.yml deploy/Caddyfile "$TARGET:$REMOTE_DIR/"
# shellcheck disable=SC2086
scp $SSH_OPTS "$ENV_FILE" "$TARGET:$REMOTE_DIR/secrets/.env.local"
ssh_ "chmod 600 $REMOTE_DIR/secrets/.env.local && printf 'PUBLIC_HOST=%s\nCOVERPILOT_IMAGE=%s\n' '$PUBLIC_HOST' '$TAG' > $REMOTE_DIR/.env"

echo "==> starting"
ssh_ "cd $REMOTE_DIR && docker compose up -d"

echo
echo "Deployed. Open https://$PUBLIC_HOST (presenter view: https://$PUBLIC_HOST/presenter)"
echo "The first request can take a few seconds while Caddy gets the certificate."
echo "Logs: ssh $TARGET 'cd $REMOTE_DIR && docker compose logs -f'"
