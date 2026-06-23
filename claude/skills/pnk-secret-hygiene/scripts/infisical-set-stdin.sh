#!/usr/bin/env bash
# infisical-set-stdin.sh — set ONE Infisical secret whose value is read from STDIN,
# so the value never appears in argv (ps/history), never on stdout, and the temp
# file that carries it to the CLI is shredded. Verifies by NAME + LENGTH only.
#
# The value is the ONLY thing that comes via stdin; everything else is a flag.
# Single-line values only — a multi-line value (PEM key, cert) is rejected loudly
# rather than silently truncated; set those via the UI/API.
#
#   printf '%s' "$VALUE" | infisical-set-stdin.sh \
#       --name MY_KEY --projectId <PID> --env <ENV_SLUG> [--path /some/path]
#
# Auth/endpoint come from the environment (never argv); the CLI reads these env
# vars directly, so they are never passed as flags:
#   INFISICAL_TOKEN     a bearer access token (from `infisical login … --plain --silent`)
#   INFISICAL_API_URL   self-hosted endpoint, e.g. https://infisical.example.com/api
#
# Portable: no hardcoded host, project, or identity. Bring your own token + endpoint.
# END_USAGE
set -euo pipefail

NAME="" PID="" ENV_SLUG="" SECRET_PATH="/"

usage() {
  sed -n '2,/^# END_USAGE/p' "$0" | sed '/^# END_USAGE/d; s/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --name)      NAME="$2"; shift 2 ;;
    --projectId) PID="$2"; shift 2 ;;
    --env)       ENV_SLUG="$2"; shift 2 ;;
    --path)      SECRET_PATH="$2"; shift 2 ;;
    -h|--help)   usage 0 ;;
    *) echo "unknown arg: $1" >&2; usage 1 ;;
  esac
done

[ -n "$NAME" ] && [ -n "$PID" ] && [ -n "$ENV_SLUG" ] || {
  echo "ERROR: --name, --projectId and --env are required" >&2; usage 1; }
: "${INFISICAL_TOKEN:?set INFISICAL_TOKEN in the environment (do not pass it as an arg)}"
: "${INFISICAL_API_URL:?set INFISICAL_API_URL in the environment (self-hosted endpoint)}"
command -v infisical >/dev/null || { echo "ERROR: infisical CLI not found" >&2; exit 1; }

# Export so the child `infisical` process inherits them — the CLI honors both env
# vars natively. This keeps the bearer token OUT of argv (passing --token=… would
# leak it to `ps`/history — exactly what this skill warns against).
export INFISICAL_TOKEN INFISICAL_API_URL

if [ -t 0 ]; then
  echo "ERROR: read the secret VALUE from stdin, e.g.  printf '%s' \"\$V\" | $0 --name … " >&2
  exit 1
fi

# Read ALL of stdin (not one line — `read` would silently drop everything after the
# first newline). $(cat) strips only the trailing newline, which is what we want.
VALUE="$(cat)"
case "$VALUE" in
  *$'\n'*) echo "ERROR: value is multi-line; the dotenv --file form can't carry it safely. Use the UI/API." >&2; exit 1 ;;
esac

umask 077
TMP="$(mktemp "${TMPDIR:-/tmp}/.inf-set.XXXXXX")"
# shellcheck disable=SC2064
trap "shred -u '$TMP' 2>/dev/null || rm -f '$TMP'" EXIT
printf '%s=%s\n' "$NAME" "$VALUE" > "$TMP"

# The actual write. Stdout+stderr muted because the CLI may echo a confirmation
# table containing the value. --file keeps the value out of argv; token+domain come
# from the exported env vars above (never flags).
if infisical secrets set --file="$TMP" \
      --projectId="$PID" --env="$ENV_SLUG" --path="$SECRET_PATH" >/dev/null 2>&1; then
  printf 'OK: set %s at %s (env=%s, path=%s); value length=%s\n' \
    "$NAME" "$PID" "$ENV_SLUG" "$SECRET_PATH" "$(printf '%s' "$VALUE" | wc -c | tr -d ' ')"
else
  echo "ERROR: infisical secrets set failed (check token scope / projectId / env slug)" >&2
  exit 1
fi
