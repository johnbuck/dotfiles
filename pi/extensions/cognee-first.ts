// Cognee-first for pi, two layers matching Claude Code:
//  1. before_agent_start appends the rule to every turn's system prompt (reminder).
//  2. tool_call gate: the session's FIRST research tool call is blocked with an
//     instructive nudge unless recall already ran — one block per session max,
//     so non-homelab sessions pay a single retry. (Gate reinstated 2026-08-03
//     after a remind-only trial was ignored in practice.)
// FAIL-OPEN: internal errors never block work.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RULE =
  "Homelab rule: call the `recall` tool (cognee) BEFORE grepping files, opening docs, " +
  "or answering from memory — one call returns the relevant docs plus shared agent memory. " +
  "Skip only if the task clearly does not touch the Pinkleberry homelab. " +
  "Doing multi-step work? Append progress to the file that owns it (backlog spec 'As built', " +
  "incident report, or the project's own doc) AS YOU GO, in this turn — " +
  "never save it for the end of the session.";

const RESEARCH_TOOLS = new Set(["bash", "read", "grep", "glob", "find", "list", "ls"]);

let recallDone = false;
let nudged = false;

// Subagents spawned by pi-subagents carry PI_SUBAGENT_CHILD; the parent session
// already ate its nudge, so children skip the gate (reminder still applies).
const IS_SUBAGENT = !!process.env.PI_SUBAGENT_CHILD;

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: event.systemPrompt + "\n\n" + RULE };
  });

  if (IS_SUBAGENT) return;

  pi.on("tool_call", async (event, _ctx) => {
    try {
      const name = (event.toolName || "").toLowerCase();
      if (name === "recall" || name.includes("cognee")) {
        recallDone = true;
        return;
      }
      if (recallDone || nudged || !RESEARCH_TOOLS.has(name)) return;
      nudged = true;
      return {
        block: true,
        reason:
          "Homelab rule (one-time nudge, not an error): call the `recall` tool (cognee) FIRST — " +
          "one call returns the relevant docs plus shared agent memory. If this task does not " +
          "touch the Pinkleberry homelab, or no cognee tool is available, retry your call as-is and continue.",
      };
    } catch {
      return;
    }
  });
}
