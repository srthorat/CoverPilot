#!/usr/bin/env bash
# Builds a clean, single-commit copy of this project for a public GitHub repository.
#
#   scripts/prepare-public-repo.sh [target-dir]        (default: ../coverpilot-public)
#
# - Exports ONLY what is committed at HEAD (git archive), so untracked or ignored files such as
#   omni_browse/.env.local, voice-agent-py/data or a stray key file can never enter the export.
# - Leaves out private working notes: docs/notes/ (pasted AI-chat and early design notes, not part of the
#   product) and the root todo.md (private task list).
# - Leaves out build output, test output, local data, any .env* except .env.example, and any PDF larger than
#   2 MB except the bundled sample PDFs.
# - Scans the export for secrets and aborts if anything looks like one. The scan compares against the real
#   key values in omni_browse/.env.local WITHOUT printing them.
# - Creates a new git repository with ONE commit. It does not create a remote and does not push.
#
# Author of the commit: set PUBLIC_AUTHOR_NAME and PUBLIC_AUTHOR_EMAIL. They default to your git config
# user.name, but the email is NOT taken from git config unless you pass --use-git-config-email, because the
# configured address may be a work address you do not want in a public history.
set -euo pipefail

USE_GIT_EMAIL=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--use-git-config-email" ]; then USE_GIT_EMAIL=1; else ARGS+=("$a"); fi
done
cd "$(dirname "$0")/.."
ROOT="$PWD"
scan_dir() {
  local TARGET="$1"
  SECRETS_TMP="$(mktemp)"; trap 'rm -f "$SECRETS_TMP"' EXIT
  ENV_FILE="$ROOT/omni_browse/.env.local"
  if [ -f "$ENV_FILE" ]; then
    for var in META_MODEL_API_KEY META_API_KEY GOOGLE_TTS_API_KEY GUARDIAN_OPEN_API_KEY TURN_CREDENTIAL TURN_USERNAME; do
      val="$(sed -n -E "s/^${var}=(\"([^\"]*)\"|'([^']*)'|([^#[:space:]]*)).*/\2\3\4/p" "$ENV_FILE" | head -1)"
      # skip empty values and the id half of a combined token only if too short to be meaningful
      [ "${#val}" -ge 8 ] && printf '%s\n' "$val" >> "$SECRETS_TMP"
      # a "<id>.<secret>" token: scan both halves as well
      case "$val" in *.*) for part in ${val//./ }; do [ "${#part}" -ge 8 ] && printf '%s\n' "$part" >> "$SECRETS_TMP"; done ;; esac
    done
  fi
  FOUND=0
  if [ -s "$SECRETS_TMP" ] && grep -r -I -l -F -f "$SECRETS_TMP" "$TARGET" >/dev/null 2>&1; then
    echo "ABORT: a real key value from omni_browse/.env.local appears in these files:" >&2
    grep -r -I -l -F -f "$SECRETS_TMP" "$TARGET" >&2
    FOUND=1
  fi
  PATTERNS='(wk-[A-Za-z0-9]{10,}|ws-[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|[Bb]earer [A-Za-z0-9._~+/=-]{20,}|(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z_]*[=:][ ]*["'"'"']?[A-Za-z0-9+/_.-]{24,})'
  # lock files and the sample documents contain long hashes and fictional values; skip them for the pattern scan only
  HITS="$(grep -r -I -n -E "$PATTERNS" "$TARGET" --exclude=pnpm-lock.yaml --exclude=uv.lock --exclude-dir=samples 2>/dev/null \
    | grep -v -E 'Bearer \$\{|Bearer \{|Bearer <|your_[a-z_]*key|META_MODEL_API_KEY=your|invalid-key-for-failure-test' \
    | cut -d: -f1,2 || true)"
  if [ -n "$HITS" ]; then
    echo "ABORT: something in the export looks like a secret (file:line only, review these lines):" >&2
    printf '%s\n' "$HITS" >&2
    FOUND=1
  fi
  [ "$FOUND" = 0 ] && echo "    scan clean"
  return "$FOUND"
}

if [ "${ARGS[0]:-}" = "--scan" ]; then scan_dir "${ARGS[1]:?usage: --scan <dir>}" && exit 0 || exit 1; fi
TARGET="${ARGS[0]:-$ROOT/../coverpilot-public}"

NAME="${PUBLIC_AUTHOR_NAME:-$(git config user.name || true)}"
if [ -n "${PUBLIC_AUTHOR_EMAIL:-}" ]; then
  EMAIL="$PUBLIC_AUTHOR_EMAIL"
elif [ "$USE_GIT_EMAIL" = 1 ]; then
  EMAIL="$(git config user.email || true)"
else
  echo "Set PUBLIC_AUTHOR_EMAIL for the public commit (for example your GitHub noreply address," >&2
  echo "<id>+<user>@users.noreply.github.com). The current git config email is" >&2
  echo "  '$(git config user.email || echo unset)'" >&2
  echo "and is not used unless you pass --use-git-config-email." >&2
  exit 1
fi
[ -n "$NAME" ] && [ -n "$EMAIL" ] || { echo "author name and email are required" >&2; exit 1; }

if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  echo "target exists and is not empty: $TARGET" >&2
  exit 1
fi
mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"

echo "==> exporting HEAD"
if ! git diff --quiet HEAD -- 2>/dev/null || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "    note: you have uncommitted or untracked changes; only what is committed at HEAD is exported" >&2
fi
# git archive reads the committed tree, so untracked or ignored files (keys, local data) cannot be included.
git archive HEAD | tar -x -C "$TARGET"
(
  cd "$TARGET"
  rm -rf docs/notes todo.md voice-agent-py/data tools/sample-policy/__pycache__
  find . -type d \( -name test-results -o -name __pycache__ \) -prune -exec rm -rf {} +
  find . -type f \( -name '.env' -o -name '.env.*' \) ! -name '.env.example' -delete
  find . -type f -name '*.pdf' -size +2097152c ! -path './omni_browse/public/samples/*' -delete
)

echo "==> scanning for secrets"
scan_dir "$TARGET" || exit 1

echo "==> creating a single-commit repository"
cd "$TARGET"
git init -q -b main
git add -A
GIT_AUTHOR_NAME="$NAME" GIT_AUTHOR_EMAIL="$EMAIL" GIT_COMMITTER_NAME="$NAME" GIT_COMMITTER_EMAIL="$EMAIL" \
  git -c commit.gpgsign=false commit -q -m "CoverPilot: voice co-browsing and Integrity Guardian for term-life applications"
echo "    $(git ls-files | wc -l | tr -d ' ') files, commit $(git log --format=%h -1), author $NAME <$EMAIL>"

cat <<NEXT

Export ready: $TARGET

Next steps (not run for you):
  1. Create an EMPTY repository on GitHub (no README, no license), public, under the account you want.
  2. cd "$TARGET"
  3. git remote add origin https://github.com/<account>/<repo>.git
  4. git push -u origin main
  5. Open the repository in a logged-out browser: check the README renders, the diagram shows, and the
     "Built during the hackathon" paragraph (marked OWNER: confirm) says what you want.
NEXT
