# tooling

Personal development tooling and machine setup — portable across machines (e.g. onto a work box).
**Contains no secrets, credentials, or personal data** (enforced by `.gitignore` + a pre-commit
secret scan).

## Layout

```
tooling/
├── hooks/pre-commit     # secret-leak guard (active for commits in this repo)
├── mcp-servers/         # MCP server reference: custom-repo links + off-the-shelf wrappers
└── dotfiles/
    ├── claude/          # Claude Code config — see dotfiles/claude/README.md
    ├── opencode/        # OpenCode config
    └── ghostty/         # Ghostty terminal config
```

Each tool under `dotfiles/` is self-contained with its own README and (where relevant) installer.
Custom MCP servers live in their own repos (linked from `mcp-servers/README.md`).

## Setup

```bash
git clone https://github.com/johnbuck/tooling ~/tooling
cd ~/tooling
git config core.hooksPath hooks     # enable the secret-scan hook
```

Then install whichever tool config you want, e.g. `dotfiles/claude/install.sh`.

## Safety

This repo is an **allowlist** — only hand-vetted files are tracked. The `.gitignore` and
`hooks/pre-commit` (gitleaks if installed, else a grep fallback) are backstops that block any
commit containing a token or a known-sensitive filename.
