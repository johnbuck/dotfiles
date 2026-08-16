#!/bin/bash
# User-global cognee-first reminder. The homelab repo has its own project-level
# UserPromptSubmit hook with this text, so suppress there to avoid double-injection.
IN=$(cat)
cwd=$(jq -r '.cwd // empty' <<<"$IN" 2>/dev/null)
case "$cwd" in
  */Bismouth/homelab*) exit 0 ;;
esac
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Homelab rule: call mcp__cognee__recall BEFORE grepping files, opening docs, or answering from memory - one call returns the docs plus shared agent memory. Skip only if the task clearly does not touch the Pinkleberry homelab. Doing multi-step work? Append progress to the owning doc AS YOU GO, in this turn."}}'
