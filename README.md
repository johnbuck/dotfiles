# tooling

My dev setup. Portable across machines. No secrets.

A pre-commit scan blocks any commit with a token or sensitive filename.

## Layout

```
tooling/
├── hooks/pre-commit   # secret guard
├── agents/            # AI agent configs (OpenClaw / Juliet)
├── mcp-servers/       # MCP server links + wrappers
└── dotfiles/
    ├── claude/        # Claude Code
    ├── opencode/      # OpenCode
    └── ghostty/       # Ghostty terminal
```

Each folder has its own README.

## Setup

```bash
git clone https://github.com/johnbuck/tooling ~/tooling
cd ~/tooling
git config core.hooksPath hooks    # turn on the secret scan
```

Then run the installer for whatever you want, e.g. `dotfiles/claude/install.sh`.

## Safety

Allowlist only. Nothing is tracked unless I added it by hand. `.gitignore` and the pre-commit hook catch the rest.
