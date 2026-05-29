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

FULL='█'  # full block
EMPTY='░' # light shade
SEP='│'   # vertical line
RESET=$'\e[0m'

# make_bar PCT [WIDTH] [YELLOW_AT] [RED_AT]
# Echoes a colored [████░░░░] bar (no trailing newline). Defaults: width 10,
# yellow >=50%, red >=80%. Color ramps green -> yellow -> red as PCT rises.
make_bar() {
  local pct=$1 width=${2:-10} yel=${3:-50} red=${4:-80}
  pct=${pct%%.*}                       # floor any float to an int
  [[ -z "$pct" || ! "$pct" =~ ^[0-9]+$ ]] && pct=0
  (( pct > 100 )) && pct=100
  local filled=$(( pct * width / 100 ))
  (( filled > width )) && filled=width
  local empty=$(( width - filled )) color bar=""
  if   (( pct >= red )); then color=$'\e[38;2;231;76;60m'    # red    #E74C3C
  elif (( pct >= yel )); then color=$'\e[38;2;241;196;15m'   # yellow #F1C40F
  else                        color=$'\e[38;2;46;204;113m'   # green  #2ECC71
  fi
  (( filled > 0 )) && bar+=$(printf "${FULL}%.0s" $(seq 1 $filled))
  (( empty  > 0 )) && bar+=$(printf "${EMPTY}%.0s" $(seq 1 $empty))
  printf '%s[%s]%s' "$color" "$bar" "$RESET"
}

# --- context window (keeps the original 30/50 thresholds) ---
pct=$(( total > 0 ? used * 100 / total : 0 ))
(( pct > 100 )) && pct=100

now=$(date '+%H:%M %Z')
line="$now $SEP $model_name $SEP $(make_bar "$pct" 10 30 50) $(humanize "$used") / $(humanize "$total") (${pct}%)"

# --- plan rate-limit budget (Claude.ai Pro/Max only; appears after the first
#     API response in a session, so it may be absent — render only when present) ---
five_pct=$(jq -r '.rate_limits.five_hour.used_percentage // empty' <<<"$input")
week_pct=$(jq -r '.rate_limits.seven_day.used_percentage // empty' <<<"$input")
if [[ -n "$five_pct" ]]; then
  fp=$(printf '%.0f' "$five_pct")
  line+=" $SEP 5h $(make_bar "$fp" 6) ${fp}%"
fi
if [[ -n "$week_pct" ]]; then
  wp=$(printf '%.0f' "$week_pct")
  line+=" $SEP wk $(make_bar "$wp" 6) ${wp}%"
fi

# --- session cost (cumulative, client-side estimate; works on API/Enterprise
#     auth too, where the rate-limit bars are absent) ---
cost=$(jq -r '.cost.total_cost_usd // empty' <<<"$input")
if [[ -n "$cost" ]]; then
  line+=$(printf ' %s $%.2f' "$SEP" "$cost")
fi

printf '%s\n' "$line"
