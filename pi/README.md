# pi-config

Portable [pi](https://pi.dev) configuration — the parts of my `~/.pi/agent/` worth
carrying between machines. **Contains no secrets, credentials, or session history.**

## What's here

| Path | What it is |
|------|------------|
| `extensions/secret-leak-guard.ts` | A `tool_call` guard for the `bash` and `read` tools that hard-blocks the highest-confidence "leak a secret value into context" commands. A self-contained TypeScript port of [`../claude/hooks/secret-leak-guard.sh`](../claude/hooks/secret-leak-guard.sh) — same deny rules, same reasons, verified equivalent by a differential test (84/84 cases). Global: pi auto-discovers `~/.pi/agent/extensions/*.ts` with no project-trust gate, so it applies everywhere. |
| `install.sh` | Deploys `extensions/` into `~/.pi/agent/`, backing up anything it overwrites. |

## What the guard blocks

Curated for **precision over coverage** — only patterns that are almost always a leak:

- Infisical value dumps: `infisical secrets get`, bare `infisical secrets`, unredirected `export`, `set`/`delete` without `>/dev/null`, `--plain`, `--value`.
- `curl` against secret APIs (`secrets/raw`, `universal-auth/login`) or with an inline `clientSecret`/`secretValue`.
- `set -x` / `bash -x` tracing an auth flow.
- `cat`/`head`/`less`/`strings`/… and `grep`/`sed`/`dd` of credential files (`.env`, `*.pem`, `*.key`, `id_rsa`, `credentials.json`, `*secret*.yaml`, …).
- Reading a Hermes/agent `data/config.yaml` (inline secrets).
- Bare `env`/`printenv`, `docker exec … env`, `pgrep -a`/`ps aux`/`ps -o args` (argv dumps), `/proc/<pid>/environ`.

It explicitly **allows** the safe forms the rules steer you toward: `infisical run`,
`--output-file`, `>/dev/null 2>&1`, `grep -q`/`-l`/`-c`, `awk -F= '{print $1}'`, `… | wc -c`,
`sed -i`, `printenv NAME | wc -c`. Docs/markdown/templates (`*.md`, `*.example`) stay readable.

## What is deliberately NOT here

Never committed (and never touched by `install.sh`) — these stay per-machine:

- `auth.json`, `keys.env` (provider auth / API keys)
- `models-store.json` (cached model catalog)
- `sessions/` (conversation history)

## Install on a new machine

```bash
git clone https://github.com/johnbuck/dotfiles ~/dotfiles
cd ~/dotfiles
git config core.hooksPath hooks    # turn on the repo's secret-scan hook
cd pi && ./install.sh
```

Extensions auto-load on the next `pi` start (or `/reload` in a running session).

## Keeping the port in sync with the Claude hook

`secret-leak-guard.ts` and `../claude/hooks/secret-leak-guard.sh` are **independent
implementations that are verified equivalent**. If you edit one, port the change to the
other and re-run a differential test (same cases through both; they must agree) so they
don't silently drift.
