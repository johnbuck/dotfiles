// Guard parity test.
//
// Runs one battery of deny/allow cases through all three secret-leak-guard
// implementations and compares them:
//   - Claude : claude/hooks/secret-leak-guard.sh   (bash CLI; the canonical reference)
//   - pi     : pi/extensions/secret-leak-guard.ts   (TS; imported via Node type-stripping)
//   - OpenCode: opencode/plugins/pnk-guardrails.js  (JS; invoked via its hook interface)
//
// GATING: Claude must equal pi on every case (these two are the verified-identical pair).
//         Any Claude<->pi mismatch exits non-zero (fails CI).
// INFORMATIONAL: OpenCode is run and its deviations are printed, but never gate the exit
//         code — OC currently has narrower coverage (no Read guard; subset of bash rules).
//         The summary lists exactly what OC is missing so it can be reconciled deliberately.
//
// Hermetic: no network, no API keys, no repo deps. Needs only bash + jq + Node >= 22.6
// (for --experimental-strip-types). Run:
//   node --experimental-strip-types tests/guard-parity.mjs
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PnkGuardrails } from "../opencode/plugins/pnk-guardrails.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const BASH_HOOK = resolve(REPO, "claude/hooks/secret-leak-guard.sh");

// --- load the pi TS extension via native type-stripping ---
const pi = await import(pathToFileURL(resolve(REPO, "pi/extensions/secret-leak-guard.ts")).href);

// --- instantiate the OpenCode plugin and pull its bash hook ---
const noop = async () => {};
const ocHooks = await PnkGuardrails({
  client: { tui: { showToast: noop }, app: { log: noop }, session: { prompt: noop } },
  $: () => ({ quiet: () => ({ text: async () => "" }) }),
  directory: REPO,
});
const ocBefore = ocHooks["tool.execute.before"];

// --- decision functions: each returns "DENY" | "ALLOW" ---
function bashDecision(command) {
  const r = spawnSync(BASH_HOOK, [], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf-8",
  });
  const out = (r.stdout || "").trim();
  if (!out) return "ALLOW";
  try {
    const o = JSON.parse(out)?.hookSpecificOutput ?? JSON.parse(out);
    return o?.permissionDecision === "deny" ? "DENY" : "ALLOW";
  } catch {
    return "ALLOW";
  }
}
function piBash(command) {
  return pi.checkBash(command) ? "DENY" : "ALLOW";
}
function piRead(path) {
  return pi.checkRead(path) ? "DENY" : "ALLOW";
}
async function ocBash(command) {
  try {
    await ocBefore({ tool: "bash" }, { args: { command } });
    return "ALLOW";
  } catch {
    return "DENY";
  }
}
function bashReadDecision(path) {
  const r = spawnSync(BASH_HOOK, [], {
    input: JSON.stringify({ tool_name: "Read", tool_input: { file_path: path } }),
    encoding: "utf-8",
  });
  const out = (r.stdout || "").trim();
  if (!out) return "ALLOW";
  try {
    const o = JSON.parse(out)?.hookSpecificOutput ?? JSON.parse(out);
    return o?.permissionDecision === "deny" ? "DENY" : "ALLOW";
  } catch {
    return "ALLOW";
  }
}

// --- case battery ---
const bashCases = [
  // Infisical
  ["infisical get", "infisical secrets get DB_PASSWORD"],
  ["infisical bare list", "infisical secrets"],
  ["infisical list flag", "infisical secrets --env=dev"],
  ["infisical export", "infisical export"],
  ["infisical set", "infisical secrets set FOO --file=/tmp/x"],
  ["infisical --plain", "infisical secrets --plain"],
  ["infisical --value", "infisical secrets set FOO --value=bar"],
  ["infisical run (allow)", "infisical run -- ./deploy.sh"],
  ["infisical export --output-file (allow)", "infisical export --output-file=/tmp/x.env"],
  ["infisical set >/dev/null (allow)", "infisical secrets set FOO --file=/tmp/x >/dev/null 2>&1"],
  ["infisical folders (allow)", "infisical secrets folders list"],
  // curl
  ["curl clientSecret", 'curl -d \'{"clientSecret":"x"}\' https://x/api'],
  ["curl secrets/raw", "curl https://x/api/secrets/raw/foo"],
  ["curl universal-auth", "curl -X POST https://x/api/auth/universal-auth/login"],
  ["curl -d @file (allow)", "curl -d @body.json https://x"],
  ["curl piped (allow)", "curl https://x/api/secrets/raw/foo | jq -r .secretValue"],
  // shell tracing
  ["bash -x infisical", "bash -x infisical-login.sh"],
  ["set -x bearer", "set -x; curl -H 'Authorization: Bearer x' https://x"],
  ["bash -x build (allow)", "bash -x build.sh"],
  // cat-family credential files
  ["cat ~/.env", "cat ~/.env"],
  ["head prod.env", "head -20 prod.env"],
  ["less id_rsa", "less ~/.ssh/id_rsa"],
  ["cat key.pem", "cat server.key.pem"],
  ["strings kdbx", "strings vault.kdbx"],
  ["cat README.md (allow)", "cat README.md"],
  ["cat .env.example (allow)", "cat deploy/.env.example"],
  ["wc -l .env (allow)", "wc -l ~/.env"],
  // grep
  ["grep PASS prod.env", "grep PASS prod.env"],
  ["rg TOKEN app.env", "rg TOKEN app.env"],
  ["grep -q (allow)", "grep -q '^DB_' .env"],
  ["grep -c (allow)", "grep -c ERROR app.log"],
  ["grep non-secret (allow)", "grep PASS config.txt"],
  // sed / dd
  ["sed env", "sed 's/a/b/' app.env"],
  ["dd key.pem", "dd if=server.key.pem"],
  ["sed -i (allow)", "sed -i 's/a/b/' app.env"],
  ["dd of= (allow)", "dd if=server.key.pem of=/tmp/k bs=1 count=1"],
  // agent config.yaml
  ["cat agent config", "cat /opt/hermes/data/config.yaml"],
  ["hermes container config", "docker exec hermes-bot cat config.yaml"],
  ["cat plain config.yaml (allow)", "cat /app/config.yaml"],
  // env dumps
  ["bare env", "env"],
  ["bare printenv", "printenv"],
  ["docker exec env", "docker exec ctr env"],
  ["printenv HOME (allow)", "printenv HOME"],
  ["env | wc -c (allow)", "env | wc -c"],
  // ps / pgrep / /proc
  ["pgrep -a", "pgrep -a python"],
  ["ps aux", "ps aux"],
  ["ps -ef", "ps -ef"],
  ["cat /proc/environ", "cat /proc/1234/environ"],
  ["pgrep plain (allow)", "pgrep python"],
  ["ps safe (allow)", "ps -o pid,stat,comm"],
  // misc
  ["ls -la (allow)", "ls -la"],
];
const readCases = [
  ["dotenv", "/home/me/.env"],
  ["prod.env", "/app/prod.env"],
  ["id_rsa", "/home/me/.ssh/id_rsa"],
  ["key.pem", "/etc/ssl/server.key.pem"],
  ["secrets.yaml", "/app/secrets.yaml"],
  ["credentials.json", "/home/me/.config/credentials.json"],
  ["agent config.yaml", "/opt/hermes/data/config.yaml"],
  ["SECRETS.md (allow)", "SECRETS.md"],
  [".env.example (allow)", ".env.example"],
  ["plain config.yaml (allow)", "/app/config.yaml"],
];

// --- run + compare ---
let gateFails = 0;
const ocDevBash = [];
const ocMissingRead = []; // OC has no Read guard at all

// Bash cases: gate Claude==pi; report OC deviations.
for (const [label, command] of bashCases) {
  const c = bashDecision(command);
  const p = piBash(command);
  const o = await ocBash(command);
  if (c !== p) {
    gateFails++;
    console.log(`GATE FAIL bash  [claude=${c} pi=${p}] ${label}  ::  ${command}`);
  }
  if (o !== c) ocDevBash.push({ label, command, claude: c, oc: o });
}

// Read cases: gate Claude==pi; OC has no Read guard (every Read = ALLOW in OC).
for (const [label, path] of readCases) {
  const c = bashReadDecision(path);
  const p = piRead(path);
  if (c !== p) {
    gateFails++;
    console.log(`GATE FAIL read  [claude=${c} pi=${p}] ${label}  ::  ${path}`);
  }
  if (c === "DENY") ocMissingRead.push({ label, path }); // OC would ALLOW these
}

// --- report ---
console.log("");
console.log(`Bash cases: ${bashCases.length}   Read cases: ${readCases.length}`);
console.log(`Gating (Claude==pi): ${gateFails === 0 ? "PASS ✅" : `FAIL ❌  (${gateFails} mismatches)`}`);

if (ocDevBash.length) {
  console.log("");
  console.log(`INFO — OpenCode bash deviations (NOT gating; OC is behind the bash hook on these):`);
  for (const d of ocDevBash) {
    console.log(`   claude=${d.claude} oc=${d.oc}  ${d.label}  ::  ${d.command}`);
  }
  console.log(`   (${ocDevBash.length}/${bashCases.length} bash cases differ — reconcile to promote OC to gating)`);
} else {
  console.log("OpenCode bash: matches Claude on all cases ✅ (eligible to gate)");
}
if (ocMissingRead.length) {
  console.log("");
  console.log(`INFO — OpenCode has NO Read guard; these Read-denies are unguarded under OC:`);
  for (const d of ocMissingRead) console.log(`   ${d.label}  ::  ${d.path}`);
  console.log(`   (${ocMissingRead.length}/${readCases.length} read cases unguarded)`);
}

process.exit(gateFails === 0 ? 0 : 1);
