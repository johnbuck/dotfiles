#!/usr/bin/env bash
# PreToolUse (Write|Edit) — spec-standard reminder for backlog/*.md.
#
# Why this exists: pnk-spec is model-discretion, so it only fires if the model
# thinks to invoke it. On 2026-07-28 five specs were hand-written straight to
# backlog/ without it; every one tripped pnk-baton's Align gate, and each halt
# burned a full build cycle (~150-180k tokens). This hook makes the reminder
# unconditional at the moment the file is written.
#
# NON-BLOCKING by design: backlog/ also holds impl-logs, canonicals, handoffs
# and ROADMAP notes, which are not specs and must not be gated.
set -uo pipefail

input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null) || exit 0

# Only backlog markdown.
case "$path" in
  */backlog/*.md | backlog/*.md) ;;
  *) exit 0 ;;
esac

# Exempt the non-spec artifacts that legitimately live in backlog/.
case "$path" in
  *-impl-log.md | *impl-log* | *IMPL-LOG* | *CANONICAL* | *canonical* \
  | *handoff* | *HANDOFF* | *ROADMAP* | *README* | *STATUS*) exit 0 ;;
esac

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"SPEC STANDARD REMINDER (backlog/*.md): if this is a NEW spec, invoke the pnk-spec skill instead of hand-writing it. Every spec must carry: (1) a code-verified 'Current behavior (as-is)' inventory with exact file:line for EVERY element on the touched path (missing co-writes and call sites is the classic failure); (2) a KEEP/CHANGE/REMOVE change map dispositioning each as-is element, where REMOVE lines are the only authorized deletions; (3) a North Star check quoting the governing canon verbatim from the real file, never invented rules; (4) the actual code at plan-mode specificity for non-trivial changes, not prose describing it; (5) testable acceptance criteria including at least one error path. Verify each claim against the source before writing it -- pnk-baton's Align gate HALTS on a spec missing these, and every halt costs a full build cycle. Impl-logs, canonicals, handoffs, STATUS and ROADMAP edits are exempt from this reminder."}}
JSON
