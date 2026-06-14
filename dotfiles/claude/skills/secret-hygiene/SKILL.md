---
name: secret-hygiene
description: >-
  Handles secrets without leaking their values to context, and covers safe
  Infisical use (CLI and REST API). Applies before reading, writing, rotating,
  exporting, or injecting any secret, credential, token, API key, password, or
  .env value, and before running the Infisical CLI or hitting its REST API.
  Explains what counts as "context", the stdout/argv leak footguns, the safe
  read/write patterns, and how to verify secrets without printing them. Relevant
  whenever a task touches credentials or Infisical.
---

# Secret hygiene

A leaked secret value cannot be un-leaked. This skill is the discipline for touching secrets at all:
read, write, rotate, inject, or verify them **without the value ever entering context**, and use
Infisical (CLI + API) the safe way.

## Rule 0 — secret *values* never enter context

"Context" = chat transcript, tool results, terminal stdout/scrollback, shell history, process args
(`ps`, `ps auxe`), log files, and error messages. A value that reaches any of these is **compromised
the instant it lands** — editing the message later does not fix it. If it happens: **stop, tell the
user, and treat the secret as needing rotation.** Do not pretend it didn't.

**Safe to surface:** a secret's *name*, its *length* (`… | wc -c`), whether it is present/absent, and
structural facts (line counts, key lists). **Never safe:** the value itself, or any command whose
normal output includes the value.

## Before you touch a secret — pre-flight

1. **Do I need the value at all?** Usually no. To make a program use a secret, *inject* it
   (`infisical run -- <cmd>`) — don't read it yourself. To check a secret exists, check name/length,
   not value.
2. **Will this command print the value?** If the command's normal output includes the secret (e.g.
   `infisical secrets get`, `infisical export`, `curl …/secrets/raw`, `echo $X`, `printenv`), it is a
   leak unless you redirect/pipe it to a file or `jq` filter. Assume "yes" and prove otherwise.
3. **Will the value land in argv?** Anything like `--value "$SECRET"` or `-d '{"x":"$SECRET"}'` puts
   it in the process command line → visible to `ps` and shell history. Pass values via **stdin** or a
   **chmod-600 file**, never as an argument.
4. **Am I tracing?** `set -x` / `bash -x` echo every command including secret args. Never debug an
   auth flow with shell tracing.

## The never-do list (these all leak)

- `cat` / `head` / `tail` / `less` / `grep -r` on a `.env` or any credential file.
- `echo "$SECRET"`, `printenv`, `env`, `docker exec … env`, `docker inspect` on a secret-bearing target.
- `infisical secrets get NAME`, bare `infisical secrets` (list), `infisical export` **without**
  redirection. `--plain` makes it worse; `--silent` does **not** hide values.
- Secret in argv: `infisical secrets set NAME --value …`, `curl -d '{"secretValue":"…"}'`.
- Piping any secret through a chat/tool result to move it between hosts. Use a 600 tempfile + `scp` +
  `shred -u`.

## Safe patterns (the short version)

```bash
# READ → don't. Inject into the child process instead; value never hits stdout.
infisical run --projectId=<PID> --env=<ENV> --path=<PATH> -- <your-command>

# If a value MUST materialize, send it to a 600 file — never to the terminal.
umask 077
infisical export --format=dotenv --output-file=./.env   # not `> .env` under a re-auth prompt
# …then consume ./.env programmatically; never cat it back.

# WRITE → value via stdin/file, stdout muted, verify by name+length only.
# ($CLAUDE_SKILL_DIR is set automatically by Claude Code to this skill's directory.)
printf '%s' "$VALUE" | "$CLAUDE_SKILL_DIR/scripts/infisical-set-stdin.sh" \
  --name MY_KEY --projectId <PID> --env <ENV> --path <PATH>

# VERIFY without exposure
awk -F= '{print $1}' file.env | sort     # names only
wc -l file.env                            # structure only
docker exec <ct> sh -c 'printenv MY_KEY | wc -c'   # length only, never the value
```

## Infisical essentials

- **Self-hosted is the default assumption.** Always pass the instance endpoint
  (`--domain "$INFISICAL_API_URL"` for the CLI; that base URL for the API). Never assume the cloud
  (`*.infisical.com`). Use a hostname the resolver honors — Go-based CLIs skip mDNS `.local`, so use a
  real DNS name or IP.
- **Auth** = machine identity (Universal Auth): exchange client-id + client-secret for a short-lived
  bearer token; capture it into a variable, never echo it. Prefer the client-secret via env var over
  argv.
- **Writes often need a privileged identity.** Read-only/Viewer identities get `403` on `set`. Know
  which identity can write before you try (a project may route writes through one admin identity).

## Reference material (load on demand)

- Full leak-vector catalog + verify-without-exposure techniques → [references/context-leak-vectors.md](references/context-leak-vectors.md)
- Infisical **CLI** — auth, `run`/`export`/`get`/`set`, every footgun + safe form → [references/infisical-cli.md](references/infisical-cli.md)
- Infisical **REST API** — universal-auth login, secrets CRUD, the plaintext-response leak → [references/infisical-api.md](references/infisical-api.md)
- Safe-write helper (value via stdin, never argv) → `scripts/infisical-set-stdin.sh` (run with `--help`)

If the repo you're working in has its own secret-handling doc (e.g. a `SECRETS.md`) with the actual
endpoint, project IDs, and write-path, follow it — it overrides the generic placeholders here.
