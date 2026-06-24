# openclaw-accessibility

An OpenClaw plugin that checks web pages for accessibility problems
([axe-core](https://github.com/dequelabs/axe-core) against WCAG).

## Which do I use? (start here)

There are **two ways** to run an audit. Pick by the kind of browser your agent has:

- **Your agent only has browser MCP tools** (e.g. AWS AgentCore reached via MCP),
  no CDP endpoint → **use the `a11y-auditor` skill.** The agent drives its own
  `browser_navigate` / `browser_evaluate`. Nothing to configure.
- **You have a CDP browser** (a local/headless Chromium, or an AgentCore session)
  → **use the `a11y_audit` tool** and point its provider at that browser.

Why two: a plugin tool cannot call another tool on OpenClaw (verified), so the
tool can't reuse the browser MCP — that case is the skill's job, not the tool's.
Don't run both paths on the same agent; choose one.

## What it is

- **Tool `a11y_audit`** — audits a `url` (or raw `html`) against a WCAG standard
  with axe-core, via a configurable **provider**: `cdp` (default — a standing CDP
  browser) or `agentcore` (per-audit AWS session). Returns
  `{ ok, standard, target, summary, violations }`, or `{ ok:false, error, message }`
  on failure — it never throws, so a failed audit can't break the agent turn.
- **Skill `a11y-auditor`** — runs an audit by driving the agent's own browser
  tools (loads axe-core from a CDN) and turns the violations into a prioritized
  report. The path for MCP-only agents.
- **Skill `accessibility`** — WCAG 2.1 AA guidance + correction table +
  `references/`; points at the auditor skill to measure.

## Triggers (what activates the skills)

The agent picks up these skills from how the request is phrased:

**`a11y-auditor`** (run an audit) — triggers on:
- "accessibility audit" / "audit this page for accessibility"
- "ADA audit" / "ADA compliance check"
- "Section 508 audit" / "508 compliance"
- "WCAG audit" / "WCAG compliance check"
- "screen-reader check", "keyboard navigation check", "color-contrast check"

**`accessibility`** (build/fix accessible UI) — triggers on:
- "make this accessible", "fix the accessibility of…", implementing accessible components
- "focus outline missing", "aria-label required", "insufficient contrast"

Note: **ADA** and **Section 508** are assessed against **WCAG**, so those
requests run the same WCAG audit — automated (axe covers ~30–50% of WCAG), and
reported as informing conformance, not as a legal certification.

## Input

```json
{ "url": "https://example.com", "standard": "WCAG2.1AA" }
```

Provide exactly one of `url` / `html`. `standard` ∈ `WCAG2.0AA`, `WCAG2.1AA`
(default), `WCAG2.1AAA`, `best-practice`.

## Configuration (`configSchema`)

These configure the **tool** only (the skill needs no config).

| Key | Default | Description |
|-----|---------|-------------|
| `browserProvider` | `cdp` | How the browser is supplied: `cdp` (attach to a standing endpoint) or `agentcore` (per-audit AWS Bedrock AgentCore session). |
| `waitUntil` | `load` | Page navigation wait condition: `load` / `domcontentloaded` / `networkidle` / `commit`. |
| `cdpEndpoint` | `http://127.0.0.1:9222` | (`cdp` provider) CDP endpoint. `http(s)://` (local) or `ws(s)://` (remote/managed). |
| `cdpHeaders` | _(none)_ | (`cdp` provider) Optional headers for the CDP connect handshake, for a browser that authenticates the socket. |
| `connectTimeoutMs` | `30000` | Timeout for the CDP connect handshake. |
| `agentcore` | _(none)_ | (`agentcore` provider) `{ region, identifier?, sessionTimeoutSeconds?, viewport? }`. IAM auth comes from the agent's ambient AWS credentials — no keys here. |
| `defaultStandard` | `WCAG2.1AA` | Standard used when a call omits `standard`. |
| `timeoutMs` | `30000` | Max time for one audit before failing open with `timeout`. |

### Tool providers

(Both inject the **minified** axe build, `axe.min.js`, via `page.evaluate`.)

**`cdp` (default)** — attach to a standing CDP endpoint. `cdpEndpoint` accepts
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
