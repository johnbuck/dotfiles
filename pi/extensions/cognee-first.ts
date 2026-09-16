// Cognee-first for pi, single reminder layer: before_agent_start appends the
// rule to every turn's system prompt (cognee MCP is pre-wired; pi surfaces
// its tools bare, hence `recall`). The one-shot tool-blocking gate was
// removed 2026-09-15 by operator decision - cancelling the session's first
// research call was heavier than wanted; the reminder is the whole mechanism.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RULE =
  "Homelab rule: call the `recall` tool (cognee) BEFORE grepping files, opening docs, " +
  "or answering from memory — one call returns the relevant docs plus shared agent memory. " +
  "Skip only if the task clearly does not touch the Pinkleberry homelab. " +
  "Doing multi-step work? Append progress to the file that owns it (backlog spec 'As built', " +
  "incident report, or the project's own doc) AS YOU GO, in this turn — " +
  "never save it for the end of the session.";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: event.systemPrompt + "\n\n" + RULE };
  });
}
