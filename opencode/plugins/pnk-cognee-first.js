// Cognee-first for opencode, single reminder layer: chat.message appends a
// synthetic <system-reminder> part to every user message (static twin lives
// in ~/.config/opencode/AGENTS.md). The one-shot tool-blocking gate was
// removed 2026-09-15 by operator decision - cancelling the session's first
// research call was heavier than wanted; the reminder is the whole mechanism.
// Fail-open: internal errors never break messages.
export const PnkCogneeFirst = async () => {
  const RULE =
    "Homelab rule: call the cognee recall tool BEFORE grepping files, opening docs, " +
    "or answering from memory - one call returns the relevant docs plus shared agent " +
    "memory. Skip only if the task clearly does not touch the Pinkleberry homelab. " +
    "Doing multi-step work? Append progress to the file that owns it (backlog spec " +
    "'As built', incident report, or the project's own doc) AS YOU GO, in this turn - " +
    "never save it for the end of the session."

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
  }
}
