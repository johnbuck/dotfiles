#!/usr/bin/env bash
# Claude Code status line: shows model + context-window usage as a visual bar.
# Reads the status-line JSON payload from stdin; prints one line to stdout.
set -euo pipefail

input=$(cat)

model_name=$(jq -r '.model.display_name // .model.id // "Claude"' <<<"$input")
session_id=$(jq -r '.session_id // empty' <<<"$input")

# Prefer Claude Code's own context_window object — authoritative, matches /context.
# current_usage.* is per-turn (current window occupancy); total_input_tokens is
# cumulative across the whole session, so avoid it here.
total=$(jq -r '.context_window.context_window_size // empty' <<<"$input")
used=$(jq -r '
  .context_window.current_usage
  | (.input_tokens // 0)
  + (.cache_read_input_tokens // 0)
  + (.cache_creation_input_tokens // 0)
  | if . == 0 then empty else . end
' <<<"$input")

# Fall back to transcript parsing if stdin didn't carry context_window.
if [[ -z "$total" || -z "$used" ]]; then
  transcript=$(jq -r '.transcript_path // empty' <<<"$input")
  model_id=$(jq -r '.model.id // empty' <<<"$input")

  if [[ -n "${CLAUDE_CONTEXT_WINDOW:-}" ]]; then
    total=$CLAUDE_CONTEXT_WINDOW
  elif [[ "$model_id" == *"[1m]"* ]]; then
    total=1000000
  else
    total=200000
  fi

  used=0
  if [[ -n "$transcript" && -f "$transcript" ]]; then
    last=$(tac "$transcript" 2>/dev/null \
      | jq -r 'select(.message.usage) | .message.usage
               | (.input_tokens // 0)
               + (.cache_read_input_tokens // 0)
               + (.cache_creation_input_tokens // 0)' 2>/dev/null \
      | head -n1 || true)
    [[ -n "$last" ]] && used=$last
  fi
fi

humanize() {
  awk -v n="$1" 'BEGIN {
    if (n >= 1000000) printf "%.1fM", n/1000000
    else if (n >= 1000) printf "%dk", n/1000
    else printf "%d", n
  }'
}

# Cache context_window_size for the Stop hook (which doesn't receive it on stdin).
if [[ -n "$session_id" && "$total" =~ ^[0-9]+$ && $total -gt 0 ]]; then
  printf '%s' "$total" > "/tmp/claude-ctx-${session_id}" 2>/dev/null || true
fi

pct=$(( total > 0 ? used * 100 / total : 0 ))
(( pct > 100 )) && pct=100

filled=$(( pct * 10 / 100 ))
(( filled > 10 )) && filled=10
empty=$(( 10 - filled ))

FULL=$'\u2588'  # █
EMPTY=$'\u2591' # ░
SEP=$'\u2502'   # │

bar=""
(( filled > 0 )) && bar+=$(printf "${FULL}%.0s" $(seq 1 $filled))
(( empty  > 0 )) && bar+=$(printf "${EMPTY}%.0s" $(seq 1 $empty))

if   (( pct >= 50 )); then COLOR=$'\e[38;2;231;76;60m'    # red    #E74C3C
elif (( pct >= 30 )); then COLOR=$'\e[38;2;241;196;15m'   # yellow #F1C40F
else                       COLOR=$'\e[38;2;46;204;113m'   # green  #2ECC71
fi
RESET=$'\e[0m'

printf '%s %s %s[%s] %s / %s (%d%%)%s\n' \
  "$model_name" "$SEP" "$COLOR" "$bar" "$(humanize "$used")" "$(humanize "$total")" "$pct" "$RESET"
