// secrets-guard core — the single source of truth for secret-leak deny rules.
//
// Pure JS (no deps, no types) so it is: run directly by `node` as the Claude
// hook CLI, imported natively by the OpenCode plugin (Bun), and imported by the
// pi extension (jiti). All three adapters call checkBash()/checkRead() from here.
//
// Logic ported verbatim from the pi TS extension (verified equivalent to the
// Claude bash hook on an 84-case differential test). DESIGN notes carried over:
//  - PRECISION OVER COVERAGE: only near-certain leaks are denied; safe forms are
//    explicitly allowed (infisical run / --output-file / set >/dev/null / grep -q
//    / awk -F= '{print $1}' / | wc -c).
//  - The deny reason never echoes the command (it may contain a secret).
//  - KNOWN LIMITATION: the whole command string is scanned, so a trigger phrase
//    appearing as quoted text is also blocked (safe-fail).
//  - KNOWN RESIDUALS (behavioral, not denied): awk '{print}' file, programmatic
//    reads (python -c / node -e / perl -e), infisical run -- printenv, read-loops.

// Basename of a path with surrounding quotes stripped (port of the shell's tr -d).
function baseName(p) {
  const stripped = p.replace(/["']/g, "");
  const slash = stripped.lastIndexOf("/");
  return slash >= 0 ? stripped.slice(slash + 1) : stripped;
}

// True if a path's basename looks like a credential/secret FILE. Excludes docs +
// templates (*.example, *.md, *.pub, ...) so SECRETS.md / *.env.example stay readable.
export function isSecretFile(rawPath) {
  const bn = baseName(rawPath);
  if (/\.(example|sample|template|dist|md|markdown|rst|pub)$/.test(bn)) return false;
  if (/(^\.env$|^\.env\.|\.env$)/.test(bn)) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore|kdbx|asc|gpg)$/.test(bn)) return true;
  if (/^id_(rsa|ed25519|ecdsa|dsa)$/.test(bn)) return true;
  if (/^(\.netrc|\.npmrc|\.pgpass|\.git-credentials|auth\.json|credentials|credentials\.json|\.credentials\.json)$/.test(bn)) return true;
  if (/(secret|credential).*\.(json|ya?ml|env|conf|cfg|ini|txt|properties|tfvars)$/i.test(bn)) return true;
  return false;
}

// A Hermes/agent config.yaml embeds INLINE secrets but is named plainly.
// Matches <...>/data/config.ya?ml (covers /opt/data/config.ya?ml too).
function isAgentConfigPath(rawPath) {
  return /\/data\/config\.ya?ml$/.test(rawPath.replace(/["']/g, ""));
}

// Strip one surrounding quote char from each end (port of the shell's
// ${tok%\"}${tok#\"}${tok%\'}${tok#\'}).
function stripQuotes(tok) {
  let t = tok;
  if (t.endsWith('"')) t = t.slice(0, -1);
  if (t.startsWith('"')) t = t.slice(1);
  if (t.endsWith("'")) t = t.slice(0, -1);
  if (t.startsWith("'")) t = t.slice(1);
  return t;
}

// Does any bare (non-flag) token name a credential file? Handles dd's `if=FILE`.
function touchesSecretFile(cmd) {
  for (const tok of cmd.split(/\s+/)) {
    const t = stripQuotes(tok).replace(/^if=/, "");
    if (t === "" || t.startsWith("-")) continue;
    if (isSecretFile(t)) return true;
  }
  return false;
}

// Does the command reference a Hermes/agent config.yaml (inline secrets)?
function touchesAgentConfig(cmd) {
  for (const tok of cmd.split(/\s+/)) {
    if (isAgentConfigPath(stripQuotes(tok))) return true;
  }
  if ((/hermes-[A-Za-z0-9_-]+/.test(cmd) || /(^|\s)-u\s+hermes(\s|$)/.test(cmd))
    && /(^|[^A-Za-z0-9_-])config\.ya?ml/.test(cmd)) {
    return true;
  }
  return false;
}

// Read tool: returns the deny reason, or null = allow.
export function checkRead(path) {
  if (!path) return null;
  if (isSecretFile(path)) {
    return "secret-leak-guard: reading a credential file surfaces its values into context. Don't read it — check presence/length instead (e.g. `grep -q '^NAME=' file`, `… | wc -c`), or inject the value with `infisical run -- <cmd>`. (Allowed for *.example/*.md.)";
  }
  if (isAgentConfigPath(path)) {
    return "secret-leak-guard: a Hermes/agent config.yaml embeds inline secrets (dashboard basic_auth password, provider API keys, bot tokens). Don't read the whole file — grep one key's presence (`grep -q '^  password:' file`), list top-level keys (`grep -E '^[a-z]' file`), or copy it and strip secret lines before reading.";
  }
  return null;
}

// Bash tool: returns the first matching deny reason, or null = allow.
// Rule order matches the shell hook (first match wins).
const CAT_FAMILY = /(^|[^A-Za-z0-9_-])(cat|bat|tac|nl|head|tail|less|more|most|view|xxd|hexdump|od|strings)(\s)/;
const GREP_FAMILY = /(^|[^A-Za-z0-9_-])(grep|egrep|fgrep|rg|ag)(\s)/;
const SED_PRESENT = /(^|[^A-Za-z0-9_-])sed(\s)/;
const DD_PRESENT = /(^|[^A-Za-z0-9_-])dd(\s)/;

export function checkBash(cmd) {
  if (!cmd) return null;
  const has = (re) => re.test(cmd);
  const stdoutRedirect = has(/(&>|1>|(^|[^0-9&])>)/);
  const grepSafe = has(/(^|\s)-[A-Za-z]*[qlcL]|--quiet|--silent|--files-with-matches|--count/);
  const catFamily = has(CAT_FAMILY);
  const grepFamily = has(GREP_FAMILY);
  const sedPresent = has(SED_PRESENT);
  const ddPresent = has(DD_PRESENT);

  // Infisical (the incident class)
  if (has(/infisical\s+secrets\s+get/)) {
    return "secret-leak-guard: `infisical secrets get` prints the value to stdout (context). Inject it with `infisical run -- <cmd>`, or export to a chmod-600 file with `--output-file`.";
  }
  if (has(/infisical\s+secrets(\s+(--|$|-)|\s*$)/) && !has(/infisical\s+secrets\s+(set|delete|folders)/)) {
    return "secret-leak-guard: listing Infisical secrets prints every value to stdout (context). Read names only (`infisical export --output-file=f && awk -F= '{print $1}' f`) or inject with `infisical run`.";
  }
  if (has(/infisical\s+export/) && !has(/--output-file/) && !stdoutRedirect) {
    return "secret-leak-guard: `infisical export` dumps all values to stdout. Use `--output-file=<chmod-600 file>` (preferred) or redirect to a file — never to the terminal.";
  }
  if (has(/infisical\s+secrets\s+(set|delete)/) && !stdoutRedirect) {
    return "secret-leak-guard: `infisical secrets set/delete` can echo a confirmation containing the value. Append `>/dev/null 2>&1` (the value goes via --file/stdin, never argv). `--silent` does NOT hide it.";
  }
  if (has(/--plain/) && has(/infisical\s+(secrets|export)/)) {
    return "secret-leak-guard: `--plain` on infisical secrets/export prints clean machine-readable values to stdout. (`--plain` is fine on `infisical login` to capture a token.)";
  }
  if (has(/infisical\s+secrets\s+set/) && has(/--value(\s|=)/)) {
    return "secret-leak-guard: `--value` puts the secret in argv (ps/history). Use `--file=<dotenv>` or stdin instead.";
  }

  // curl against the secret API
  if (has(/\bcurl\b/) && has(/("?(secretValue|clientSecret)"?\s*:)/) && !has(/-d\s+@/) && !has(/--data\s+@/)) {
    return "secret-leak-guard: a clientSecret/secretValue inline in `-d '{...}'` lands in argv (ps). Send the body from a chmod-600 file: `-d @body.json` (build it with `jq -n --arg`).";
  }
  if (has(/\bcurl\b/) && has(/(secrets\/raw|universal-auth\/login)/) && !has(/\|/) && !stdoutRedirect && !has(/-o\s/) && !has(/--output/)) {
    return "secret-leak-guard: this curl returns plaintext secrets/token to stdout (context). Pipe it through `jq` to extract only what you need, or write the body to a chmod-600 file.";
  }

  // shell tracing of an auth/secret flow
  if (has(/(set\s+-[A-Za-z]*x|(bash|sh)\s+-[A-Za-z]*x)/) && has(/(infisical|client-?[Ss]ecret|secretValue|Authorization|Bearer|token=|clientSecret)/)) {
    return "secret-leak-guard: `-x`/`set -x` traces every command including secret args. Don't trace auth/secret flows; use controlled output instead.";
  }

  // cat-family / pagers reading a credential file
  if (catFamily && touchesSecretFile(cmd)) {
    return "secret-leak-guard: printing a credential file dumps its values into context. Use `awk -F= '{print $1}' file` (names), `wc -l file` (count), or `grep -q '^NAME=' file` (presence). (Allowed for *.example/*.md.)";
  }

  // grep that would print value lines from a credential file
  if (grepFamily && !grepSafe && touchesSecretFile(cmd)) {
    return "secret-leak-guard: grepping a credential file prints matching value lines into context. Use `grep -q`/`-l`/`-c` (presence/count only) or `awk -F= '{print $1}' file` for names.";
  }

  // sed (without -i) / dd (without of=) reading a credential file to stdout
  if (sedPresent && !has(/(^|\s)-i/) && touchesSecretFile(cmd)) {
    return "secret-leak-guard: `sed` without `-i` prints the credential file to stdout (context). Edit in place with `-i`, or read names with `awk -F= '{print $1}' file`.";
  }
  if (ddPresent && !has(/of=/) && touchesSecretFile(cmd)) {
    return "secret-leak-guard: `dd` reading a credential file with no `of=` prints it to stdout (context). Don't — check presence/length instead.";
  }

  // read-family printing a Hermes/agent config.yaml (inline secrets)
  if (touchesAgentConfig(cmd) && (catFamily || (grepFamily && !grepSafe) || (sedPresent && !has(/(^|\s)-i/)))) {
    return "secret-leak-guard: a Hermes/agent config.yaml embeds inline secrets (dashboard basic_auth password, provider API keys, bot tokens). Don't print it into context. Check a key's presence with `grep -q '^  password:' file`, edit in place with `sed -i`, or copy the file and strip secret lines before reading non-secret values.";
  }

  // full env dump that includes secrets
  if (has(/(^|[;&]\s*)(printenv|env)(\s*$|\s*[;&])/)) {
    return "secret-leak-guard: a bare `printenv`/`env` dumps every variable (incl. secrets) to context. Check one var's length instead: `printenv NAME | wc -c`.";
  }
  if (has(/docker\s+(exec|run)[^|]*\s(env|printenv)(\s*$|\s*['"]?$)/) && !has(/wc\s+-c/)) {
    return "secret-leak-guard: dumping a container's full environment surfaces its secrets. Check one var's length: `docker exec <c> sh -c 'printenv NAME | wc -c'`.";
  }

  // process argv / environ dumps (the read side)
  if (has(/(^|[^A-Za-z0-9_-])pgrep\s[^|;&]*(-[A-Za-z]*a[A-Za-z]*|--list-full)/)) {
    return "secret-leak-guard: `pgrep -a`/`--list-full` prints each process's full command line, which can hold a secret passed in argv (e.g. an injected `--token=`). Get PIDs only (`pgrep NAME`) or names (`pgrep -l`).";
  }
  if (has(/(^|[^A-Za-z0-9_-])ps\s+-?[A-Za-z]*a[A-Za-z]*x/)
    || has(/(^|[^A-Za-z0-9_-])ps\s+[^|;&]*-[A-Za-z]*([eA][A-Za-z]*[fF]|[fF][A-Za-z]*[eA])/)
    || has(/(^|[^A-Za-z0-9_-])ps\s+[^|;&]*-o\s*[^|;&]*(args|command|cmd)([^A-Za-z]|$)/)) {
    return "secret-leak-guard: this `ps` shows other processes' full command lines (the args column), which can hold a secret passed in argv (e.g. an injected `--token=`). Use an args-free format (`ps -o pid,stat,comm`) or check a specific PID.";
  }
  if (has(/\/proc\/[^/\s]+\/environ/)
    || (has(/\/proc\/[^/\s]+\/cmdline/) && has(/(^|[^A-Za-z0-9_-])(cat|bat|tac|nl|head|tail|less|more|most|view|xxd|hexdump|od|strings|tr|grep|egrep|fgrep|rg|ag|xargs)(\s)/))) {
    return "secret-leak-guard: reading `/proc/<pid>/environ` or `cmdline` dumps that process's environment or arguments, which routinely include secrets. Don't read it; there is almost always a targeted check that doesn't.";
  }

  return null;
}
