# claude-config

Portable [Claude Code](https://claude.com/claude-code) configuration — the parts of my
`~/.claude/` worth carrying between machines (e.g. onto a work box). **Contains no
secrets, credentials, conversation history, or personal data.**

## What's here

| Path | What it is |
|------|------------|
| `settings.json` | Permissions (allow/deny/ask), statusline, enabled plugins, effort prefs. Paths use a `__HOME__` token that `install.sh` resolves. |
| `scripts/` | Statusline scripts (`context-status.sh`, `context-warn.sh`) referenced by `settings.json`. |
| `agents/` | Subagent definitions (skill / slash-command / subagent auditors, plus the `baton-*` pipeline agents). |
| `workflows/`, `commands/`, `hooks/` | **baton** — a multi-agent build/review pipeline (`/baton <spec>`): plan → test-first → build → review → auto-merge, each run in its own git worktree. See [`BATON.md`](./BATON.md). |
| `skills/` | Claude Code [Skills](https://code.claude.com/docs/en/skills). `secret-hygiene` — auto-loads when a task touches secrets/credentials/Infisical; teaches not leaking values to context + safe Infisical CLI/API use. SKILL.md + `references/` + a stdin-only safe-write helper. |
| `hooks/secret-leak-guard.sh` | PreToolUse(Bash\|Read) guard that hard-blocks the highest-confidence secret-leak commands (`infisical secrets get`/unredirected `export`/`set`, `--plain` dumps, `cat`/`grep` of `.env`/key files, `curl` of `/secrets/raw`, full `env` dumps, reading credential files). Wired **globally** in `settings.json` (unlike `baton-guard`, which is per-repo). Companion backstop to the `secret-hygiene` skill. |
| `plugins/local/project-planning/` | Local `do-the-thing` plugin (`do-specs` + `do-scaffold` skills). Eval/benchmark artifacts were stripped — only the working plugin ships. |
| `plugins/*.json` | Manifest of which marketplaces/plugins to install (reference + used by installer). |
| `.mcp.json.example` | Full MCP server set (sanitized). `__MCP_HOST__` placeholder for the LAN host; tokens via `${ENV_VAR}`. Copy to `~/.claude/.mcp.json` and fill in. |
| `install.sh` | Deploys the above into `~/.claude/`, backing up anything it overwrites. |
| `hooks/pre-commit` | Secret-leak guard (gitleaks if present, else grep fallback) that blocks committing tokens. |

## What is deliberately NOT here

Never committed — these stay on each machine and are blocked by `.gitignore` + the pre-commit hook:

- `.credentials.json`, `.claude.json` (OAuth account, user ID)
- `.mcp.json` (live MCP bearer tokens)
- `history.jsonl`, `transcripts/`, `projects/` (incl. memory), `sessions/`, `tasks/`, caches

## Install on a new machine

```bash
git clone https://github.com/johnbuck/dotfiles ~/dotfiles
cd ~/dotfiles/dotfiles/claude
./install.sh
```

Then, by hand (these involve secrets/accounts and are never automated):

1. `claude` → authenticate (creates your own `.credentials.json`).
2. MCP servers (optional): `cp .mcp.json.example ~/.claude/.mcp.json`, then:
   - replace `__MCP_HOST__` with the host running your servers (drop the entries you don't use),
   - export the token env vars the file references: `YNAB_MCP_BEARER`, `EXCALIDRAW_GEN_BEARER`,
     `TODOIST_API_TOKEN` (e.g. in your shell profile). The `${VAR}` refs expand at load time, so
     no secrets live in the file.
3. Restart Claude Code to pick up settings + plugins.

> Note: your live MCP config actually lives inside `~/.claude.json` (with real tokens) — that file
> is never committed. This `.mcp.json.example` is the portable, sanitized equivalent.

## Permission posture

`settings.json` ships a **conservative** default: `defaultMode: default` (Claude asks before
acting) with broad read-only/dev commands pre-allowed and destructive ones denied or gated to
`ask`. Loosen it per-machine if you want — don't loosen it in this public repo.

## Safety

This repo is an **allowlist**: only hand-vetted files are tracked. The `.gitignore` and the
`hooks/pre-commit` scan are backstops. `install.sh` runs `git config core.hooksPath hooks`, so
the secret scan is active for any commit you make here.
