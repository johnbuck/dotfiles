# claude-config

Portable [Claude Code](https://claude.com/claude-code) configuration — the parts of my
`~/.claude/` worth carrying between machines (e.g. onto a work box). **Contains no
secrets, credentials, conversation history, or personal data.**

## What's here

| Path | What it is |
|------|------------|
| `settings.json` | Permissions (allow/deny/ask), statusline, enabled plugins, effort prefs. Paths use a `__HOME__` token that `install.sh` resolves. |
| `scripts/` | Statusline scripts (`context-status.sh`, `context-warn.sh`) referenced by `settings.json`. |
| `agents/` | Subagent definitions (skill / slash-command / subagent auditors). |
| `plugins/local/project-planning/` | Local `do-the-thing` plugin (`do-specs` + `do-scaffold` skills). Eval/benchmark artifacts were stripped — only the working plugin ships. |
| `plugins/*.json` | Manifest of which marketplaces/plugins to install (reference + used by installer). |
| `.mcp.json.example` | Template for MCP servers. Copy to `~/.claude/.mcp.json` and fill in your own tokens. |
| `install.sh` | Deploys the above into `~/.claude/`, backing up anything it overwrites. |
| `hooks/pre-commit` | Secret-leak guard (gitleaks if present, else grep fallback) that blocks committing tokens. |

## What is deliberately NOT here

Never committed — these stay on each machine and are blocked by `.gitignore` + the pre-commit hook:

- `.credentials.json`, `.claude.json` (OAuth account, user ID)
- `.mcp.json` (live MCP bearer tokens)
- `history.jsonl`, `transcripts/`, `projects/` (incl. memory), `sessions/`, `tasks/`, caches

## Install on a new machine

```bash
git clone <this-repo-url> ~/claude-config
cd ~/claude-config
./install.sh
```

Then, by hand (these involve secrets/accounts and are never automated):

1. `claude` → authenticate (creates your own `.credentials.json`).
2. If you use MCP servers: `cp .mcp.json.example ~/.claude/.mcp.json` and fill in tokens.
3. Restart Claude Code to pick up settings + plugins.

## Permission posture

`settings.json` ships a **conservative** default: `defaultMode: default` (Claude asks before
acting) with broad read-only/dev commands pre-allowed and destructive ones denied or gated to
`ask`. Loosen it per-machine if you want — don't loosen it in this public repo.

## Safety

This repo is an **allowlist**: only hand-vetted files are tracked. The `.gitignore` and the
`hooks/pre-commit` scan are backstops. `install.sh` runs `git config core.hooksPath hooks`, so
the secret scan is active for any commit you make here.
