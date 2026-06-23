# openclaw-accessibility

Native OpenClaw plugin that adds a real accessibility-audit capability.

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

AgentCore exposes a CDP **WebSocket** with signed auth. Point the plugin at it
and pass the headers its session minted:

```json5
{ plugins: { entries: { "openclaw-accessibility": { config: {
  cdpEndpoint: "wss://<agentcore-cdp-host>/...",   // the session ws URL
  cdpHeaders: { "Authorization": "...", "X-Amz-Date": "..." }
} } } } }
```

The plugin only **passes headers through** to `connectOverCDP` — it does not
mint AWS SigV4 itself (that would couple it to one cloud). If your agent reaches
AgentCore through a **local CDP proxy** that handles auth, just set
`cdpEndpoint` to that proxy's `ws://…` and leave `cdpHeaders` empty.

> Note: SigV4-signed headers are short-lived. For a long-running agent that
> connects **directly** (no proxy), the headers in static config will expire —
> the local-proxy pattern (which refreshes auth) is the durable setup.

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

## Install (pointer)

Installing this plugin into a live OpenClaw agent is deploy-specific and
intentionally out of scope here. Point the agent's OpenClaw plugin config at
this directory, set `cdpEndpoint` (and `cdpHeaders` if the browser authenticates
its CDP socket), then verify with `openclaw plugins inspect openclaw-accessibility`.
