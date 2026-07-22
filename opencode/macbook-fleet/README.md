# opencode: MacBook operator fleet

A self-contained OpenCode config for guided coding-agent machines run by **nontechnical
operators**. It steers the agent toward a fixed house stack and a safe, reversible workflow, so the
operator never has to answer an infrastructure question. This is a **separate config** from the
personal one in the parent `opencode/` directory; the only piece they share is the guardrails
plugin (see below).

**Sanitized — no secrets, no real hostnames/IPs.** Real hosts and keys are `__PLACEHOLDER__`s filled
in at deploy time, never committed.

## What's here

| Path | What it is |
|------|------------|
| `opencode.json` | Main config: model (`deepseek-v4-pro`), OpenRouter + local llama.cpp providers, Playwright + Serena MCP, and an allow-most `permission` policy with secret/config floors. |
| `AGENTS.md` | Global steering: plain-language conduct, the one required build path (self-contained project, run in the shared workbench), reversible-by-default rules. In context every session via the `instructions` array. |
| `skills/pnk-preferences.yaml` | The admin-edited house stack and quality gates the agent steers toward instead of quizzing the operator. Also in context every session. |
| `skills/pnk-*/` | Eight `pnk-*` skills: new-project, spec, roadmap, scaffold, ship-check, safe-change, secrets, explain. |
| `command/*.md` | Six operator commands: `new-project`, `spec`, `roadmap`, `scaffold`, `ship-it`, `commit`. |
| `workbench/` | The one shared Docker dev environment (Python + Node toolchain + a shared Postgres) that every project runs inside. |

The **guardrails plugin is not duplicated here** — it is the single shared copy at
`../plugins/pnk-guardrails.js`, deployed alongside this config. Keeping one copy is deliberate: it
stays rule-for-rule aligned with the Claude Code hook `claude/hooks/secret-leak-guard.sh`.

## Placeholders to fill in

`opencode.json` ships with placeholders instead of real values:

| Placeholder | Replace with |
|-------------|--------------|
| `__LLM_HOST__` | `host:port` of the local llama.cpp server (the `llama-cpp` provider `baseURL`), or drop that provider. |
| `__OR_KEY__` | Name of the env var holding this machine's OpenRouter key (one per machine), injected at launch. |
| `__SERENA__` | Path to the `serena` binary on the machine. |

The local llama.cpp provider also expects a `LLAMA_CPP_API_KEY` env var if you keep it.

## Deploy

The build/deploy tooling lives on the admin workstation, outside this repo, because it carries the
real per-machine hosts, accounts, and key names. It stages this config, substitutes the
placeholders above, and copies it into each operator account's `~/.config/opencode/` over SSH. This
directory is the **canonical source** for the config content; the off-repo tooling only supplies
topology. Never commit real hosts or accounts back here.
