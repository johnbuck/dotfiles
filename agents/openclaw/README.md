# openclaw

Configuration for **Juliet**, an [OpenClaw](https://openclaw.ai) conversational + dev agent.
**Sanitized** — no secrets, tokens, real hostnames/IPs, chat IDs, or operator PII. The live config
runs on a private agent host; this is the portable, scrubbed equivalent.

## Layout

| Path | What it is |
|------|------------|
| `openclaw.json` | Agent + model-provider + channel + plugin config. Secrets are `dummy`/`${ENV}` placeholders; the gateway-auth token is `${GATEWAY_AUTH_TOKEN}`. |
| `identity/` | Juliet's persona + operating docs (see below). |
| `plugins/pipeline-guard/` | Custom plugin enforcing a 15-stage build pipeline at the tool layer, plus its 13 bundled stage skills under `skills/`. |
| `plugins/sessions-worktree-injector/` | Custom plugin: per-stage git-worktree isolation for subagent dispatches. |

### identity/

| File | Role |
|------|------|
| `IDENTITY.md` / `SOUL.md` | Who Juliet is + voice/behavioral rules. |
| `USER.md` | Operator profile (genericized here). |
| `AGENTS.md` | Workspace conduct: memory, Recall, group-chat, heartbeat behavior, git workflow, the 8-rule subagent dispatch protocol. |
| `HEARTBEAT.md` | Proactive heartbeat loop — pipeline progress, merging, blockers, proposals, memory hygiene. |
| `BUILD_PIPELINE.md` | The agent-agnostic 15-stage build pipeline. |
| `MEMORY.md` | Long-term curated memory (operator profile genericized). |
| `TOOLS.md` | Local setup notes. |

## Placeholders

`openclaw.json` carries `${GATEWAY_AUTH_TOKEN}` and `dummy` provider keys (real model keys are
injected by the gateway proxy at runtime). `identity/` uses `the operator` / `<timezone>` /
`<OPERATOR_CHAT_ID>` in place of real values. Internal service routes use the in-container
`gateway:8080` proxy names.

## Not included

- Telegram bot tokens, Infisical-managed secrets, `.telegram-token` files — runtime-only, never committed.
- The research-pipeline "North Star" goals (relocated to that pipeline's own repo).
- Workspace runtime state (sessions, daily memory logs, backups).
