#!/usr/bin/env bash
# Pre-recording check: is everything the demo needs actually working right now?
#   scripts/preflight.sh            quick checks (container, page, review model, vault)
#   scripts/preflight.sh --voice    also runs the spoken test (about 40 s, uses the live models)
# Keys are read from omni_browse/.env.local and never printed.
set -uo pipefail
cd "$(dirname "$0")/.."
BASE="${BASE_URL:-http://localhost:3000}"
fail=0
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }
warn() { printf '  warn  %s\n' "$1"; }

echo "Container"
status="$(docker inspect -f '{{.State.Health.Status}}' coverpilot 2>/dev/null || echo missing)"
[ "$status" = "healthy" ] && ok "coverpilot container is healthy" || bad "coverpilot container is '$status' (docker build -t coverpilot:local . and run it, see README)"

echo "Pages"
for path in / /presenter /samples/sample-policy-with-issues.pdf /samples/sample-policy.pdf; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$BASE$path")"
  [ "$code" = "200" ] && ok "$path answers 200" || bad "$path answers $code"
done
for f in omni_browse/public/samples/sample-policy.pdf omni_browse/public/samples/sample-policy-with-issues.pdf; do
  n="$(pdfinfo "$f" 2>/dev/null | awk '/Pages/{print $2}')"
  [ -n "$n" ] && ok "$(basename "$f") has $n pages" || warn "could not read $(basename "$f") (pdfinfo missing?)"
done

echo "Review model (the Integrity Guardian)"
( cd voice-agent-py && uv run python - <<'PY'
import re, sys, time, json
env = {}
for line in open('../omni_browse/.env.local').read().splitlines():
    m = re.match(r'^([A-Z0-9_]+)=(?:"([^"]*)"|\'([^\']*)\'|([^#\s]*))', line)
    if m:
        env[m.group(1)] = m.group(2) or m.group(3) or m.group(4)
provider = env.get('GUARDIAN_PROVIDER', 'spark')
from openai import OpenAI
if provider == 'spark-open':
    client = OpenAI(base_url=env['GUARDIAN_OPEN_BASE_URL'], api_key=env['GUARDIAN_OPEN_API_KEY'], timeout=120, max_retries=0)
    model, extra = env.get('GUARDIAN_OPEN_MODEL', 'meta-models/Muse-Spark-Open-816B-A42B'), {'reasoning_effort': 'low'}
else:
    client = OpenAI(base_url=env.get('META_MODEL_BASE_URL', 'https://api.meta.ai/v1'), api_key=env['META_MODEL_API_KEY'], timeout=60, max_retries=0)
    model, extra = env.get('META_MODEL_SPARK', 'muse-spark-1.3'), {}
t = time.time()
try:
    client.chat.completions.create(model=model, messages=[{"role": "user", "content": "Reply OK."}], max_tokens=32, temperature=0, extra_body=extra)
    print(f"  ok    provider '{provider}' answered in {time.time()-t:.1f}s ({model})")
except Exception as e:
    code = getattr(e, 'status_code', '?')
    print(f"  FAIL  provider '{provider}' failed (HTTP {code}). For Modal check billing; or set GUARDIAN_PROVIDER=\"spark\" in omni_browse/.env.local and restart the container.")
    sys.exit(1)
PY
) || fail=1

echo "Saved-proposal vault"
docker exec coverpilot sh -c 'mkdir -p /app/voice-agent-py/data/vault && touch /app/voice-agent-py/data/vault/.w && rm /app/voice-agent-py/data/vault/.w' 2>/dev/null \
  && ok "vault folder is writable" || bad "vault folder is not writable in the container"

if [ "${1:-}" = "--voice" ]; then
  echo "Spoken test (microphone to speech recognition to agent to form)"
  ( cd omni_browse && BASE_URL="$BASE" npx playwright test e2e/voice.spec.ts --reporter=line 2>&1 | tail -3 ) \
    && ok "voice test finished (see lines above)" || bad "voice test failed"
fi

echo
echo "By hand before you press record:"
echo "  - headphones on, OBS mic meter moving, Chrome microphone allowed for localhost"
echo "  - Chrome zoom 80% (or a 1080p display), bookmarks bar hidden, notifications off"
echo "  - site data cleared for localhost so the opening choice shows"
echo "  - nothing with a key or .env.local on screen"
[ $fail -eq 0 ] && echo && echo "Ready to record." || { echo; echo "Fix the FAIL lines first."; }
exit $fail
