# dotfiles

Portable dev setup — Claude Code config, agent definitions, and terminal/editor
dotfiles that carry between machines. **No secrets, no machine-specific ops.**

A pre-commit scan blocks any commit with a token or sensitive filename.

## Layout

```
dotfiles/
├── hooks/pre-commit   # secret guard
├── agents/            # AI agent harness configs
│   ├── openclaw/      # OpenClaw (Juliet)
│   └── hermes/        # Hermes — portable plugins + skills
├── mcp-servers/       # MCP server links + wrappers
├── claude/            # Claude Code (incl. the pnk-baton pipeline — see claude/PNK-BATON.md)
├── opencode/          # OpenCode
└── ghostty/           # Ghostty terminal
```

Each folder has its own README.

## Setup

```bash
git clone https://github.com/johnbuck/dotfiles ~/dotfiles
cd ~/dotfiles
git config core.hooksPath hooks    # turn on the secret scan
```

Then run the installer for whatever you want, e.g. `claude/install.sh`.

## Scope

Portable, machine-agnostic config only. Anything tied to a specific host or to
private infrastructure (ops scripts, service runbooks, secrets) lives in a
separate private repo — not here.

## Safety

Allowlist only. Nothing is tracked unless I added it by hand. `.gitignore` and the pre-commit hook catch the rest.
