#!/bin/bash
# One-shot cognee-first gate: the session's FIRST research tool call is denied
# with an instructive nudge unless recall already ran. One denial per session
# maximum, so non-homelab sessions pay a single retry. Fail-open on any error.
IN=$(cat)
sid=$(jq -r '.session_id // empty' <<<"$IN" 2>/dev/null)
tool=$(jq -r '.tool_name // empty' <<<"$IN" 2>/dev/null)
[ -z "$sid" ] || [ -z "$tool" ] && exit 0
dir=/tmp/claude-cognee-gate
mkdir -p "$dir" 2>/dev/null || exit 0

case "$tool" in
  mcp__cognee__recall|mcp__cognee__remember)
    touch "$dir/$sid.recall"; exit 0 ;;
  Grep|Glob|Read|Bash|WebFetch|WebSearch) ;;
  *) exit 0 ;;
esac

[ -f "$dir/$sid.recall" ] && exit 0
[ -f "$dir/$sid.nudged" ] && exit 0
touch "$dir/$sid.nudged"
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Homelab rule (one-time nudge, not an error): call mcp__cognee__recall FIRST - one call returns the relevant docs plus shared agent memory. If this task does not touch the Pinkleberry homelab, or cognee is unavailable, retry your call as-is and continue."}}'
