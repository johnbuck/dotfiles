// Cognee-first for opencode, two layers matching Claude Code:
//  1. chat.message appends a synthetic <system-reminder> part to every user
//     message (reminder; static twin lives in ~/.config/opencode/AGENTS.md).
//  2. tool.execute.before gate: the session's FIRST research tool call throws
//     an instructive nudge unless cognee recall already ran — one throw per
//     session max. (Gate added 2026-08-03 after remind-only was ignored.)
// Fail-open: internal errors never break messages or tools.
export const PnkCogneeFirst = async ({ client }) => {
  const RULE =
    "Homelab rule: call the cognee recall tool BEFORE grepping files, opening docs, " +
    "or answering from memory - one call returns the relevant docs plus shared agent " +
    "memory. Skip only if the task clearly does not touch the Pinkleberry homelab. " +
    "Doing multi-step work? Append progress to the file that owns it (backlog spec " +
    "'As built', incident report, or the project's own doc) AS YOU GO, in this turn - " +
    "never save it for the end of the session."

  const RESEARCH_TOOLS = new Set(["grep", "glob", "read", "list", "bash", "webfetch"])
  // sessionID -> "recalled" | "nudged" | "exempt" (subagent sessions skip the gate)
  const state = new Map()

  const isSubagent = async (sid) => {
    try {
      const res = await client.session.get({ path: { id: sid } })
      return !!(res && res.data && res.data.parentID)
    } catch {
      return false
    }
  }

  return {
    "chat.message": async (_input, output) => {
      try {
        output.parts.push({
          id: "prt_cognee" + Math.random().toString(36).slice(2, 10),
          messageID: output.message.id,
          sessionID: output.message.sessionID,
          type: "text",
          text: "<system-reminder>" + RULE + "</system-reminder>",
          synthetic: true,
        })
      } catch {}
    },
    "tool.execute.before": async (input, _output) => {
      try {
        const tool = (input.tool || "").toLowerCase()
        const sid = input.sessionID || "global"
        if (tool.includes("cognee")) {
          state.set(sid, "recalled")
          return
        }
        const s = state.get(sid)
        if (s === "recalled" || s === "nudged" || s === "exempt" || !RESEARCH_TOOLS.has(tool)) return
        if (await isSubagent(sid)) {
          state.set(sid, "exempt")
          return
        }
        state.set(sid, "nudged")
        throw new Error(
          "Homelab rule (one-time nudge, not an error): call the cognee_recall tool FIRST - " +
          "one call returns the relevant docs plus shared agent memory. If this task does not " +
          "touch the Pinkleberry homelab, retry your call as-is and continue.")
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Homelab rule")) throw e
      }
    },
  }
}
