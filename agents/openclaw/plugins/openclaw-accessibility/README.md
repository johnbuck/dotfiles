# openclaw-accessibility

An OpenClaw plugin that adds an accessibility-audit capability.

## What it is

- **Tool `a11y_audit`** — audits a web page (`url`) or a raw HTML string
  (`html`) against a WCAG standard using [axe-core](https://github.com/dequelabs/axe-core),
  running inside a CDP-reachable Chromium via `playwright-core` `connectOverCDP`
  (no second browser is launched). The browser can be **local** (`http://…`) or
  **remote/managed** (`wss://…`, e.g. AWS Bedrock AgentCore Browser) — the
  endpoint and any auth headers are config, so the plugin is host-agnostic.
  Returns `{ ok, standard, target, summary, violations }`, or a structured
  `{ ok: false, error, message }` on failure. It **never throws out of the
  hook** — a failed audit cannot break the agent turn.
- **Skill `accessibility`** — WCAG 2.1 AA guidance plus the correction table;
  points at the six `references/` deep-dive docs and the auditor skill.
- **Skill `a11y-auditor`** — drives `a11y_audit` and turns axe violations into a
  prioritized remediation report.

## Input

```json
{ "url": "https://example.com", "standard": "WCAG2.1AA" }
```

Provide exactly one of `url` / `html`. `standard` ∈ `WCAG2.0AA`, `WCAG2.1AA`
(default), `WCAG2.1AAA`, `best-practice`.

## Configuration (`configSchema`)

| Key | Default | Description |
|-----|---------|-------------|
| `cdpEndpoint` | `http://127.0.0.1:9222` | CDP endpoint to attach to. `http(s)://` (local) or `ws(s)://` (remote/managed, e.g. AgentCore). Set per agent at deploy. |
| `cdpHeaders` | _(none)_ | Optional headers for the CDP connect handshake — for a browser that authenticates the socket (e.g. AgentCore signed `Authorization`). Omit for local. |
| `connectTimeoutMs` | `30000` | Timeout for the CDP connect handshake. |
| `defaultStandard` | `WCAG2.1AA` | Standard used when a call omits `standard`. |
| `timeoutMs` | `30000` | Max time for one audit before failing open with `timeout`. |

### Connecting to a remote/managed browser (e.g. AWS Bedrock AgentCore Browser)

The browser does not have to be local. `cdpEndpoint` accepts a `ws(s)://` URL
and `cdpHeaders` forwards any headers the CDP socket needs, so the tool can
attach to a remote/managed browser such as AWS Bedrock AgentCore Browser. The
plugin only passes headers through to `connectOverCDP`; it does not mint AWS
SigV4 itself.

> Note: SigV4-signed headers are short-lived, so a long-running agent that
> connects directly will see them expire. Reaching the browser through a local
> CDP proxy that refreshes auth avoids that.

## Tests

```bash
cd agents/openclaw/plugins/openclaw-accessibility
node --test
```

Node 26 strips TypeScript types natively, so the `node:test` suite runs the
`.ts` modules with **zero third-party packages installed** — the browser runner
is injected as a fake. `playwright-core` and `axe-core` are runtime-only
dependencies (declared in `package.json`); OpenClaw installs them under
`~/.openclaw/plugin-runtime-deps/` at install time.

## Install

Installing into a live OpenClaw agent is deploy-specific and out of scope for
this repo. In short: make this directory available to the agent's OpenClaw
plugin config, set the configuration appropriate for that environment, restart
the gateway, and verify with `openclaw plugins inspect openclaw-accessibility`.

## Credits

The `accessibility` and `a11y-auditor` skills (their `SKILL.md` and
`references/`) are forked from the MIT-licensed **accessibility** skill by
**Jeremy Dawes (Jezweb)** — <https://github.com/jezweb/claude-skills>. The WCAG
guidance is the original author's work; this plugin adapts it for OpenClaw and
adds the `a11y_audit` tool. See [`NOTICE`](./NOTICE) for the license.
