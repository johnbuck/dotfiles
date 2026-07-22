// ~/.config/opencode/plugins/pnk-guardrails.js
export const PnkGuardrails = async ({ client, $, directory }) => {
  const MODE = process.env.PNK_GUARDRAILS || "on"   // on | nonudge | off
  if (MODE !== "on") {
    try { await client.tui.showToast({ body: { message: `pnk-guardrails is in ${MODE} mode; protection is reduced.`, variant: "warning" } }) } catch {}
  }
  if (MODE === "off") return {}

  const CATASTROPHIC = [
    /\brm\b(?=[^\n|;]*(?:-\w*r|--recursive))(?=[^\n|;]*(?:-\w*f|--force))[^\n|;]*\s(?:\/\*?|~\/?|\$\{?HOME\}?\/?|\/home\/?)(?=\s|["';|]|$)/i,
    /\bfind\s+(?:\/|~\/?|\$\{?HOME\}?\/?|\/home\/?)(?=\s|$)[^\n]*(?:-delete|-exec\s+rm)\b/,
    /(?:>|>>|\btee\b|\bof=)\s*["']?\/dev\/(?:sd|nvme|vd|hd|mmcblk|disk|loop)/,
    /\b(?:wipefs|blkdiscard|shred|truncate|mkfs\S*|sgdisk)\b[^\n]*\/dev\/(?:sd|nvme|vd|mmcblk)/,
    /\bmv\b[^\n]*\s\/dev\/null\b/,
    /\bchown\b[^\n]*\s(?:-R|--recursive)\b[^\n]*\s\/(?:\s|$)/,
    /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    /\bgit\s+push\b[^\n]*(?:--force\b|\s-f\b|\s\+[\w./-]+(?::|\s|$))/,
    /\bchmod\b[^\n]*(?:-R|--recursive|-\w*R)\b[^\n]*(?:[0-7]*777|a\+?rwx)\b/,
    /\b(?:ba|z|k)?sh\b[^\n]*-c\s+["']?\$\((?:curl|wget)\b/,
    /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:(?:ba|z|k)?sh|python[\d.]*|perl|ruby|node)\b/,
  ]
  const SECRET_SHAPE = [
    /sk-(?:proj-|live-)?[A-Za-z0-9]{20,}/, /sk_live_[A-Za-z0-9]{20,}/,
    /gh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /glpat-[A-Za-z0-9_-]{20,}/,
    /AKIA[0-9A-Z]{16}/, /AIza[0-9A-Za-z_-]{30,}/, /xox[baprs]-[A-Za-z0-9-]{10,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  ]

  const isSecretFile = (tok) => {
    const bn = tok.replace(/^["']|["']$/g, "").replace(/^if=/, "").split("/").pop()
    if (!bn) return false
    if (/\.(example|sample|template|dist|md|markdown|rst|pub)$/i.test(bn)) return false
    if (/^\.env$|^\.env\.|\.env$/.test(bn)) return true
    if (/\.(pem|key|p12|pfx|jks|keystore|kdbx|asc|gpg)$/.test(bn)) return true
    if (/^id_(rsa|ed25519|ecdsa|dsa)$/.test(bn)) return true
    if (/^(\.netrc|\.npmrc|\.pgpass|\.git-credentials|auth\.json|credentials|credentials\.json|\.credentials\.json)$/.test(bn)) return true
    return /(secret|credential).*\.(json|ya?ml|env|conf|cfg|ini|txt|properties|tfvars)$/i.test(bn)
  }
  const touchesSecretFile = (cmd) =>
    cmd.split(/\s+/).some((t) => { const s = t.replace(/^["']|["']$/g, "").replace(/^if=/, ""); return s && !s.startsWith("-") && isSecretFile(s) })
  // A Hermes/agent config.yaml (.../data/config.yaml, /opt/data/config.yaml) mixes plain settings
  // with inline secrets (dashboard password, provider API keys, bot tokens) yet is named plainly,
  // so isSecretFile misses it. Match it by its agent-data location, or a read from inside a
  // hermes-* container / `-u hermes` exec that names a config.ya?ml. Mirrors the Claude hook.
  const isAgentConfigPath = (tok) => /\/data\/config\.ya?ml$/.test(tok.replace(/^["']|["']$/g, ""))
  const touchesAgentConfig = (cmd) => {
    if (cmd.split(/\s+/).some((t) => isAgentConfigPath(t))) return true
    const hermesCtx = /hermes-[A-Za-z0-9_-]+/.test(cmd) || /(^|\s)-u\s+hermes(\s|$)/.test(cmd)
    return hermesCtx && /(^|[^A-Za-z0-9_-])config\.ya?ml/.test(cmd)
  }
  const secretLeak = (cmd) => {
    const grepSafe = /(^|\s)-[A-Za-z]*[qlcL]\b|--quiet|--silent|--files-with-matches|--count/.test(cmd)
    if (/(^|[;&]\s*)(printenv|env)(\s*$|\s*[;&])/.test(cmd)) return "a bare printenv/env dumps every variable, including injected API keys, into context. Check one: `printenv NAME | wc -c`."
    if (/\binfisical\s+secrets\s+get\b/.test(cmd)) return "`infisical secrets get` prints the value into context. Inject it with `infisical run -- <cmd>` instead."
    if (/(^|[^A-Za-z0-9_-])(cat|bat|tac|nl|head|tail|less|more|most|view|xxd|hexdump|od|strings)(\s)/.test(cmd) && touchesSecretFile(cmd)) return "printing a credential file dumps its values into context. Use `awk -F= '{print $1}' f` (names) or `grep -q '^NAME=' f` (presence)."
    if (/(^|[^A-Za-z0-9_-])(grep|egrep|fgrep|rg|ag)(\s)/.test(cmd) && !grepSafe && touchesSecretFile(cmd)) return "grepping a credential file prints value lines into context. Use `grep -q`/`-l`/`-c`, or `awk -F= '{print $1}' f`."
    if (/(^|[^A-Za-z0-9_-])sed(\s)/.test(cmd) && !/(^|\s)-i/.test(cmd) && touchesSecretFile(cmd)) return "`sed` without `-i` prints the credential file into context. Edit in place with `-i`."
    const agentCfg = touchesAgentConfig(cmd)
    const agentCfgMsg = "a Hermes/agent config.yaml holds inline secrets (dashboard password, provider API keys, bot tokens). Don't print it into context. Check a key's presence with `grep -q '^  password:' f`, edit in place with `sed -i`, or copy it and strip the secret lines before reading the rest."
    if (agentCfg && /(^|[^A-Za-z0-9_-])(cat|bat|tac|nl|head|tail|less|more|most|view|xxd|hexdump|od|strings)(\s)/.test(cmd)) return agentCfgMsg
    if (agentCfg && /(^|[^A-Za-z0-9_-])(grep|egrep|fgrep|rg|ag)(\s)/.test(cmd) && !grepSafe) return agentCfgMsg
    if (agentCfg && /(^|[^A-Za-z0-9_-])sed(\s)/.test(cmd) && !/(^|\s)-i/.test(cmd)) return agentCfgMsg
    if (/(^|[^A-Za-z0-9_-])pgrep\s[^|;&]*(-[A-Za-z]*a[A-Za-z]*|--list-full)/.test(cmd)) return "`pgrep -a`/`--list-full` prints each process's full command line, which can hold a secret passed in argv (e.g. an injected `--token=`). Get PIDs only (`pgrep NAME`) or names (`pgrep -l`)."
    if (/(^|[^A-Za-z0-9_-])ps\s+-?[A-Za-z]*a[A-Za-z]*x/.test(cmd) || /(^|[^A-Za-z0-9_-])ps\s+[^|;&]*-[A-Za-z]*(?:[eA][A-Za-z]*[fF]|[fF][A-Za-z]*[eA])/.test(cmd) || /(^|[^A-Za-z0-9_-])ps\s+[^|;&]*-o\s*[^|;&]*(?:args|command|cmd)(?:[^A-Za-z]|$)/.test(cmd)) return "this `ps` shows other processes' full command lines (the args column), which can hold a secret passed in argv (e.g. an injected `--token=`). Use an args-free format (`ps -o pid,stat,comm`) or check a specific PID."
    if (/\/proc\/[^/\s]+\/environ/.test(cmd) || (/\/proc\/[^/\s]+\/cmdline/.test(cmd) && /(^|[^A-Za-z0-9_-])(cat|bat|tac|nl|head|tail|less|more|most|view|xxd|hexdump|od|strings|tr|grep|egrep|fgrep|rg|ag|xargs)(\s)/.test(cmd))) return "reading `/proc/<pid>/environ` or `cmdline` dumps that process's environment or arguments, which routinely include secrets. Don't read it."
    return null
  }

  const seen = new Map()
  const block = (rule) => { throw new Error(`pnk-guardrails stopped this action (rule: ${rule}). If it is really intended, ask the operator in plain words first.`) }
  const audit = async (outcome, rule) => {
    try { await client.app.log({ body: { service: "pnk-guardrails", level: "warn", message: `${outcome} ${rule} bash` } }) } catch {}
  }
  const nudge = async (sessionID, rule, humanMsg, modelNote, output) => {
    if (MODE === "nonudge") return
    const s = seen.get(sessionID) || new Set()
    if (s.has(rule)) return
    s.add(rule); seen.set(sessionID, s)
    output.output = `${output.output || ""}\n\n[guardrails] ${modelNote}`
    try { await client.tui.showToast({ body: { message: humanMsg, variant: "warning" } }) } catch {}
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return
      const cmd = (output.args || {}).command || ""
      if (CATASTROPHIC.some((r) => r.test(cmd))) { await audit("block", "catastrophic"); block("catastrophic-command") }
      const leak = secretLeak(cmd)
      if (leak) { await audit("block", "secret-leak"); throw new Error(`pnk-guardrails: ${leak}`) }
    },
    "tool.execute.after": async (input, output) => {
      if (MODE === "nonudge") return
      const sessionID = input.sessionID
      const args = input.args || {}
      if (input.tool === "bash") {
        const cmd = args.command || ""
        const npmGlobal = /\bnpm\s+(?:i|install)\b[^\n]*(?:\s-g\b|--global)/.test(cmd)
        const pipBare = /\bpip[\d.]*\s+install\b/.test(cmd) && !/-r\s|\bvenv\b|\.venv/.test(cmd) && !process.env.VIRTUAL_ENV
        if (npmGlobal || pipBare)
          await nudge(sessionID, "host-pollution",
            "That install may change the whole computer. Ask me to set it up inside the project instead.",
            "That install may land on the host. Prefer a container or a project-local environment. See the pnk-new-project skill.",
            output)
      } else if (["write", "edit", "apply_patch"].includes(input.tool)) {
        const content = args.content || args.newString || args.patchText || ""
        const target = args.filePath || (args.patchText || "").match(/^\*\*\* (?:Add|Update|Delete|Move to) File:\s*(.+)$/m)?.[1]?.trim() || ""
        const isEnvFile = /(^|\/)\.env(\.[^/]*)?$/.test(target)
        if (!isEnvFile && SECRET_SHAPE.some((r) => r.test(content)))
          await nudge(sessionID, "secret-shape",
            "A file looked like it holds a password or key. Keys should live in the secret store, not in code.",
            "A write looked secret-shaped. Keep keys in env or Infisical, never in code or git. See the pnk-secrets skill.",
            output)
      }
    },
    event: async ({ event }) => {
      if (event.type === "session.deleted") { seen.delete(event.properties?.sessionID); return }
      if (MODE === "nonudge" || event.type !== "session.idle") return
      const sessionID = event.properties?.sessionID
      if (!sessionID || seen.get(sessionID)?.has("commit")) return
      let dirty = ""
      try { dirty = (await $`git -C ${directory} status --porcelain`.quiet().text()).trim() } catch { return }
      if (!dirty) return
      const s = seen.get(sessionID) || new Set(); s.add("commit"); seen.set(sessionID, s)
      try { await client.tui.showToast({ body: { message: "Uncommitted changes: commit each change on its own with a clear message, or type /undo to roll back.", variant: "info" } }) } catch {}
      try { await client.session.prompt({ path: { id: sessionID }, body: { parts: [{ type: "text", text: "Guardrails note: there are uncommitted changes. Commit each logical change atomically with a short clear message before moving on. See the pnk-safe-change skill." }], noReply: true } }) } catch {}
    },
  }
}
