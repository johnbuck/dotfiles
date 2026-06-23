# openclaw-accessibility

Native OpenClaw plugin that adds a real accessibility-audit capability.

## What it is

- **Tool `a11y_audit`** — audits a web page (`url`) or a raw HTML string
  (`html`) against a WCAG standard using [axe-core](https://github.com/dequelabs/axe-core),
  running inside an existing Chromium reached over the Chrome DevTools Protocol
  (CDP) via `playwright-core` `connectOverCDP` (no second browser is launched).
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
| `cdpEndpoint` | `http://127.0.0.1:9222` | CDP endpoint of the Chromium to connect to (set per host at deploy). |
| `defaultStandard` | `WCAG2.1AA` | Standard used when a call omits `standard`. |
| `timeoutMs` | `30000` | Max time for one audit before failing open with `timeout`. |

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

Installing this plugin into a live OpenClaw/Juliet container is machine-specific
and intentionally out of scope here. Point the host's OpenClaw plugin config at
this directory and set `cdpEndpoint` to that host's managed Chromium, then
verify with `openclaw plugins inspect openclaw-accessibility`.
