# opencode

[OpenCode](https://opencode.ai) configuration. **Sanitized — contains no secrets, no real
hostnames/IPs.** Credentials are referenced as `{file:~/.config/opencode/secrets/...}`; the real
key files live only on each machine and are never committed.

## What's here

| Path | What it is |
|------|------------|
| `opencode.json` | Main config: providers (OpenRouter + local llama.cpp), MCP servers, compaction, and a detailed `permission` allow/ask/deny policy. Hosts are placeholders (see below). |
| `oh-my-openagent.json` | Agent/category → model assignments for the oh-my-openagent plugin. |
| `agents/build.md` | Custom `build` agent. |
| `commands/*.md` | Custom commands: `memory-status`, `recall`, `remember`, `voice`. |
| `secrets/*.example` | Placeholder templates listing which key files to create. **No real values.** |
| [`../secrets-guard/`](../secrets-guard/README.md) | The shared secret-leak guard (core + adapters). `install.sh` delegates to `../secrets-guard/install.sh`, which deploys the OpenCode adapter + core into `~/.config/opencode/plugins/`. The adapter keeps the catastrophic-command blocklist and nudges (toggle `PNK_GUARDRAILS=on\|nonudge\|off`); the secret-leak rules come from the shared core. |
| `install.sh` | Deploys into `~/.config/opencode/`, backing up anything it overwrites. |
| `macbook-fleet/` | Separate, self-contained OpenCode config for the guided MacBook operator accounts (its own `AGENTS.md`, `pnk-*` skills, commands, workbench). See its README. |

## Placeholders to fill in

`opencode.json` ships with host placeholders instead of real network addresses:

| Placeholder | Replace with |
|-------------|--------------|
| `__MCP_HOST__` | Host running your MCP servers (the `mcp.*.url` entries). |
| `__LLM_HOST__` | Host running your local llama.cpp server (the `llama-cpp` provider `baseURL`). |

Permission allow-paths (`~/projects/**`, `~/Docker/**`, …) are generic examples — adjust to taste.

## Not included

- The real `secrets/` key files and `.env` (machine-local; never committed).
- `node_modules/`, lockfiles, and `*.bak` config backups.
- The local `speech-opencode` plugin (its `file://` reference was removed from `opencode.json`).

## Install on a new machine

```bash
cd ~/dotfiles/opencode
./install.sh
```

Then replace the `__*_HOST__` placeholders, create the real `secrets/` files from the
`.example` templates (`chmod 600` them), and restart OpenCode.
