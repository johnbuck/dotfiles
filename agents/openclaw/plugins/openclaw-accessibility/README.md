# openclaw-accessibility

An OpenClaw plugin that adds an accessibility-audit capability.

## What it is

- **Tool `a11y_audit`** — audits a web page (`url`) or a raw HTML string
  (`html`) against a WCAG standard using [axe-core](https://github.com/dequelabs/axe-core).
  How it reaches a browser is a configurable **provider** (default `mcp` — reuse
  the agent's existing browser MCP tools; also `cdp` and `agentcore`). Returns
  `{ ok, standard, target, summary, violations }`, or a structured
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
| `browserProvider` | `mcp` | How the browser is supplied: `mcp` (reuse the agent's existing browser MCP tools), `cdp` (attach to a standing endpoint), or `agentcore` (per-audit AWS Bedrock AgentCore session). |
| `mcp` | _(none)_ | (`mcp` provider) `{ serverName, navigateTool?, evaluateTool? }`. The MCP server name your browser tools are registered under; tool names default to `browser_navigate` / `browser_evaluate`. |
| `waitUntil` | `load` | (`cdp`/`agentcore`) Page navigation wait condition: `load` / `domcontentloaded` / `networkidle` / `commit`. |
| `cdpEndpoint` | `http://127.0.0.1:9222` | (`cdp` provider) CDP endpoint. `http(s)://` (local) or `ws(s)://` (remote/managed). |
| `cdpHeaders` | _(none)_ | (`cdp` provider) Optional headers for the CDP connect handshake, for a browser that authenticates the socket. |
| `connectTimeoutMs` | `30000` | Timeout for the CDP connect handshake. |
| `agentcore` | _(none)_ | (`agentcore` provider) `{ region, identifier?, sessionTimeoutSeconds?, viewport? }`. IAM auth comes from the agent's ambient AWS credentials — no keys here. |
| `defaultStandard` | `WCAG2.1AA` | Standard used when a call omits `standard`. |
| `timeoutMs` | `30000` | Max time for one audit before failing open with `timeout`. |

### Browser providers

**`mcp` (default)** — audit through the agent's **existing** browser MCP tools,
reusing the runtime's open MCP session: no CDP socket, no SDK, no per-audit
session, **no new connection**. The runner calls `api.runtime.callTool(serverName,
toolName, input)` to drive `browser_navigate` → `browser_evaluate` (inject
axe-core) → `browser_evaluate` (run axe), then parses the returned JSON. Set
`mcp.serverName` to the server your browser tools live under; `navigateTool` /
`evaluateTool` default to `browser_navigate` / `browser_evaluate`. Raw HTML is
audited by navigating to a `data:text/html,…` URL (MCP has no `setContent`).
Needs neither `playwright-core` nor `bedrock-agentcore` installed.

**`cdp`** — attach to a standing CDP endpoint. `cdpEndpoint` accepts
`http(s)://` (local) or `ws(s)://`, and `cdpHeaders` forwards any auth headers
the socket needs. The plugin only passes headers through; it does not mint AWS
SigV4. Note: statically-configured SigV4 headers are short-lived and will expire
for a long-running agent.

**`agentcore`** — for AWS Bedrock AgentCore, where there is no standing CDP URL:
the endpoint only exists after you start a session, and its signed credentials
are short-lived. With `browserProvider: "agentcore"` the plugin starts its own
short-lived AgentCore browser session **per audit**, attaches over CDP, audits,
then stops the session. Because credentials are minted and torn down per audit,
the expiry problem does not apply (auditing is one-shot). IAM comes from the
agent's ambient AWS credentials. Requires the official `bedrock-agentcore` SDK
(declared as an `optionalDependency`) on the host.

It uses that SDK's `Browser` client, whose `generateWebSocketUrl()` returns the
CDP automation URL plus SigV4 headers (the TypeScript equivalent of the Python
`generate_ws_headers()`), so there is no manual signing. The lifecycle —
`startSession` -> `generateWebSocketUrl` -> `connectOverCDP(url, { headers })` ->
`stopSession` — mirrors the production `browser-mcp` pattern.

> Status: the SDK calls match the documented `bedrock-agentcore` TypeScript API,
> but the end-to-end `agentcore` path has not yet been run against live AWS — it
> awaits validation on a real AgentCore setup. The `cdp` provider and the local
> default are unchanged and fully tested.

## Tests

```bash
cd agents/openclaw/plugins/openclaw-accessibility
node --test
```

Node 26 strips TypeScript types natively, so the `node:test` suite runs the
`.ts` modules with **zero third-party packages installed** — the browser runner
is injected as a fake. `axe-core` is the only regular dependency; `playwright-core`
(`cdp`) and `bedrock-agentcore` (`agentcore`) are `optionalDependencies`, loaded
lazily only when their provider is used. OpenClaw installs declared deps under
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
