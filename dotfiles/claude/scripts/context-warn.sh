#!/usr/bin/env bash
# Stop hook: warn when context usage >= 50%.
# Reads the Stop hook JSON on stdin, parses the session transcript for current
# context usage, and emits a {"systemMessage": "..."} JSON if threshold crossed.
set -euo pipefail

THRESHOLD=${CLAUDE_CONTEXT_WARN_THRESHOLD:-50}

input=$(cat)
transcript=$(jq -r '.transcript_path // empty' <<<"$input")
session_id=$(jq -r '.session_id // empty' <<<"$input")

# Prefer the cached context_window_size the status line wrote for this session;
# fall back to env var, then 1M default (matches user's Opus 4.7 [1m] setup).
cache_file="/tmp/claude-ctx-${session_id}"
if [[ -n "$session_id" && -r "$cache_file" ]]; then
  TOTAL=$(<"$cache_file")
fi
TOTAL=${TOTAL:-${CLAUDE_CONTEXT_WINDOW:-1000000}}

[[ -z "$transcript" || ! -f "$transcript" ]] && exit 0

used=$(tac "$transcript" 2>/dev/null \
  | jq -r 'select(.message.usage) | .message.usage
           | (.input_tokens // 0)
           + (.cache_read_input_tokens // 0)
           + (.cache_creation_input_tokens // 0)' 2>/dev/null \
  | head -n1 || true)
used=${used:-0}

(( TOTAL > 0 )) || exit 0
pct=$(( used * 100 / TOTAL ))

(( pct < THRESHOLD )) && exit 0

humanize() {
  awk -v n="$1" 'BEGIN {
    if (n >= 1000000) printf "%.1fM", n/1000000
    else if (n >= 1000) printf "%dk", n/1000
    else printf "%d", n
  }'
}

msg="⚠ Context at ${pct}% ($(humanize "$used") / $(humanize "$TOTAL")) — run /compact or start a new session to avoid context rot."
jq -nc --arg m "$msg" '{systemMessage: $m}'
