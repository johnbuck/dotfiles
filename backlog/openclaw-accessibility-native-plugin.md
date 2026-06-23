---
title: OpenClaw accessibility native plugin with a11y_audit tool
status: specced
priority: P2
epic: openclaw-plugins
area: [openclaw, plugins]
created: 2026-06-23
tags: [backlog, accessibility, axe-core]
---

# OpenClaw accessibility native plugin with a11y_audit tool

**One sentence:** Convert the existing Claude "accessibility" skill into a native OpenClaw plugin that registers a real `a11y_audit` tool (runs axe-core in a browser and returns structured WCAG findings) and ships two skills that drive it.

## Why this exists

Today the accessibility content is a Claude Code skill bundle (`/home/trumble/Downloads/openclaw-skills-accessibility-1.0.2`). Dropped into OpenClaw it loads only as instructional text: its `agents/a11y-auditor.md` subagent and `rules/` are Claude-only and are not executed, and there is no way to actually *measure* a page's accessibility. We want OpenClaw agents (Juliet and any bot with the plugin) to run a genuine automated audit, not just recite WCAG advice.

A native plugin is the right format because it can register an in-process tool. A Claude *bundle* (which the folder already is) would load the skill text but can never add the audit capability. See `agents/openclaw/plugins/pipeline-guard/` for the sibling native-plugin conventions this follows.

## What we're building

A native OpenClaw plugin at `agents/openclaw/plugins/openclaw-accessibility/` in the `~/dotfiles` repo that:

1. Registers one agent tool, `a11y_audit`, which audits a web page or a raw HTML string against a WCAG standard using axe-core and returns a structured result.
2. Ships two AgentSkills skills: `accessibility` (the ported guidance) and `a11y-auditor` (the auditor subagent, ported from the Claude `agents/` file, that calls `a11y_audit`).
3. Carries the first unit-test harness in the repo (Node's built-in `node:test`).

## Behavior

- **Actors / systems:** An OpenClaw agent calls `a11y_audit` during a turn. The tool connects to a running Chromium over the Chrome DevTools Protocol (CDP — the wire protocol a browser exposes for remote control), the same browser OpenClaw already manages. axe-core (an open-source accessibility rule engine) runs inside that page.
- **Preconditions:** A reachable CDP endpoint (configurable). For unit tests, no browser is needed — the browser runner is mocked.
- **Main flow:**
  1. Agent invokes `a11y_audit` with either `url` or `html`, optionally `standard`.
  2. The tool validates input (exactly one of `url`/`html`), resolves the standard to axe tag set (default `WCAG2.1AA`).
  3. It connects to the CDP endpoint, opens/loads the target, injects axe-core, runs it.
  4. It shapes the raw axe output into `{ ok, standard, target, summary, violations }` and returns it.
- **Alternate & error flows:**
  - Neither `url` nor `html`, or both → return a structured validation error (`ok: false`), no browser call.
  - CDP unreachable, page load failure, axe error, or timeout → return a structured error (`ok: false`, error code + message). The tool **never throws out of the hook**; it fails open so a buggy audit cannot break the agent turn.
- **Postconditions:** The agent receives a JSON result object. No persisted state is written. Any browser page/tab the tool opened is closed.

## Acceptance criteria

These are pnk-baton's contract. Unit tests use `node:test` (Node 26 strips TypeScript types natively, so `node --test` runs the `.ts` tests with zero dependencies). The default browser runner is replaced with a fake in tests, so no real browser is required.

- **requires-url-or-html** — input with neither `url` nor `html` returns `{ ok: false, error: "invalid_input" }` and does not call the runner; verified by: `node --test` unit test `validateInput rejects empty`.
- **rejects-url-and-html** — input with both `url` and `html` returns `{ ok: false, error: "invalid_input" }`; verified by: unit test `validateInput rejects both` (the url-XOR-html rule).
- **defaults-standard-wcag21aa** — omitting `standard` resolves to the `WCAG2.1AA` axe tag set `["wcag2a","wcag2aa","wcag21a","wcag21aa"]`; verified by: unit test `buildAxeOptions default`.
- **maps-standard-to-axe-tags** — `standard: "WCAG2.1AAA"` resolves to the AAA tag set; verified by: unit test `buildAxeOptions AAA`.
- **shapes-violations** — given a canned axe result, `shapeResult` returns `summary.violations` equal to the violation count and `violations[].{id,impact,help,helpUrl,nodes}` populated; verified by: unit test `shapeResult maps fields`.
- **fails-open-on-runner-error** — when the injected runner throws, `execute` resolves to `{ ok: false, error: "audit_failed" }` and never rejects; verified by: unit test `execute fails open` (the required error-path test).
- **registers-a11y-audit-tool** — `setup(api)` calls `api.registerTool` once with `name: "a11y_audit"` and a parameters schema exposing `url`, `html`, `standard`; verified by: unit test `setup registers tool` using a fake `api` that records the registration.
- **manifest-is-native** — `openclaw.plugin.json` parses and has `id`, `name`, `description`, `configSchema`, and `"skills": ["./skills"]`; verified by: unit test `manifest shape` that reads and asserts the JSON.
- **skills-frontmatter-single-line** — both `SKILL.md` files have single-line `name:` and `description:` frontmatter (no `|` block scalar), satisfying OpenClaw's single-line-key parser; verified by: unit test `skill frontmatter single-line` that reads each file and asserts no block scalar on those keys.
- **skill-scanner-safe** — the Cisco skill-scanner reports SAFE (max severity at most INFO) on the shipped skills; verified by: `skill-scanner scan agents/openclaw/plugins/openclaw-accessibility/skills` → `Status: [OK] SAFE`.

## Technical approach

**Deploy target:** None in this spec. The plugin is built and tested in `~/dotfiles` only. Installing it into the live Juliet container on thringle is machine-specific operations and is **out of scope** (see Scope). `~/dotfiles` is a public repo; nothing host-specific or secret may be committed.

**Tool-registration API (confirmed against the running OpenClaw 2026.4.24 plugin SDK):** the entry exports a default object with a `setup(api)` method; tools are registered with `api.registerTool({ name, label, description, parameters, async execute(toolCallId, params) {…} }, opts?)`. `parameters` is a TypeBox `Type.Object({...})` schema (same convention as the in-tree `qqbot_remind` and `stock_quote` example tools). The builder should confirm the exact `Type` import path from the plugin SDK during planning.

**Architecture trace (an audit call):**
```
1. Agent turn calls tool a11y_audit { url, standard }
2. execute() -> validateInput()            (pure; url XOR html)
3. execute() -> buildAxeOptions(standard)  (pure; standard -> axe tags)
4. execute() -> runAxe(target, axeOpts)    (SEAM; default = CDP runner, injectable)
5. default runner: playwright-core connectOverCDP(cdpEndpoint)
   -> new page -> goto(url) | setContent(html) -> inject axe-core -> axe.run()
   -> close page
6. execute() -> shapeResult(axeRaw,...)     (pure) OR toErrorResult(err) on throw
7. return structured object to the agent
```
Steps 2, 3, 6 are pure functions with no browser dependency — that is where the acceptance criteria bite. Step 4 is the seam: `execute` takes the runner as an injected dependency defaulting to the real CDP runner, so tests pass a fake runner.

**Runtime-dependency strategy (why the build stays browser-free):** the default CDP runner uses **dynamic `import("playwright-core")` and `import("axe-core")` inside the function body**, with a minimal local TypeScript interface for the bits it uses (no static type import). Tests never invoke the default runner, so `node --test` and any typecheck run with **zero third-party packages installed**. `playwright-core` and `axe-core` are declared in `package.json` `dependencies` for runtime; OpenClaw installs declared plugin deps at install time under `~/.openclaw/plugin-runtime-deps/` (observed on the live host), so they are present when the plugin actually runs. We use `playwright-core` (not full `playwright`) and `connectOverCDP` precisely so the plugin does **not** download or launch its own browser — it reuses the Chromium OpenClaw already runs.

**Files:**
- `backlog/openclaw-accessibility-native-plugin.md` (new) — this spec.
- `agents/openclaw/plugins/openclaw-accessibility/package.json` (new) — `{"type":"module","openclaw":{"extensions":["./index.ts"]}}`, `dependencies` (playwright-core, axe-core), `scripts.test`.
- `agents/openclaw/plugins/openclaw-accessibility/openclaw.plugin.json` (new) — manifest: id, name, description, `configSchema`, `"skills": ["./skills"]`.
- `agents/openclaw/plugins/openclaw-accessibility/index.ts` (new) — `export default { setup(api) }` registering `a11y_audit`; thin wiring over `lib/audit.ts`.
- `agents/openclaw/plugins/openclaw-accessibility/lib/audit.ts` (new) — pure helpers `validateInput`, `buildAxeOptions`, `shapeResult`, `toErrorResult`, and `createCdpRunner(config)`; all exported for tests.
- `agents/openclaw/plugins/openclaw-accessibility/index.test.ts` (new) — `node:test` unit tests for every acceptance criterion.
- `agents/openclaw/plugins/openclaw-accessibility/tsconfig.json` (new) — editor/typecheck config (NodeNext ESM).
- `agents/openclaw/plugins/openclaw-accessibility/skills/accessibility/SKILL.md` (new) — ported; single-line `description`; body cites `references/` and instructs spawning `a11y-auditor` for a full audit.
- `agents/openclaw/plugins/openclaw-accessibility/skills/accessibility/references/*.md` (new) — the six existing reference docs moved here.
- `agents/openclaw/plugins/openclaw-accessibility/skills/a11y-auditor/SKILL.md` (new) — ported from Claude `agents/a11y-auditor.md`; Claude-only `model:`/`tools:` frontmatter dropped; single-line `description`; body calls `a11y_audit`, interprets violations, returns a verdict.
- `agents/openclaw/plugins/openclaw-accessibility/README.md` (new) — what it is, the tool, the skills, how to install (pointer only).

**Tech choices:**
- `playwright-core` + `connectOverCDP` — reuse OpenClaw's existing Chromium; `-core` avoids bundling a second browser. Playwright is the harness's existing browser stack.
- `axe-core` — the de-facto open-source WCAG rule engine; ships a self-contained injectable source, so it runs inside the page with no service.
- `node:test` (built-in) over vitest — Node 26 runs the TS tests natively with zero added dependencies; fits the repo's minimal, portable ethos. First tested plugin in the repo.

**Input schema (TypeBox), concrete example:**
```json
{ "url": "https://example.com", "standard": "WCAG2.1AA" }
```
`url` and `html` are both optional in the schema but exactly one is required at runtime (validated in `validateInput`, since TypeBox cannot express XOR cleanly). `standard` enum: `WCAG2.0AA`, `WCAG2.1AA` (default), `WCAG2.1AAA`, `best-practice`.

**Success result example:**
```json
{
  "ok": true,
  "standard": "WCAG2.1AA",
  "target": "https://example.com",
  "summary": { "violations": 2, "passes": 41, "incomplete": 1 },
  "violations": [
    {
      "id": "button-name",
      "impact": "critical",
      "help": "Buttons must have discernible text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.x/button-name",
      "nodes": [ { "target": ["button:nth-child(1)"], "html": "<button></button>" } ]
    }
  ]
}
```

**Error result schema (fail-open):**
```json
{ "ok": false, "error": "browser_unavailable",
  "message": "could not connect to CDP endpoint",
  "standard": "WCAG2.1AA", "target": "https://example.com" }
```
Error codes: `invalid_input`, `browser_unavailable`, `navigation_failed`, `audit_failed`, `timeout`.

**Configuration (configSchema):**

| Key | Default | Description |
|-----|---------|-------------|
| `cdpEndpoint` | `http://127.0.0.1:9222` | CDP endpoint of the Chromium to connect to. Overridden at deploy time per host. |
| `defaultStandard` | `WCAG2.1AA` | axe standard used when a call omits `standard`. |
| `timeoutMs` | `30000` | Max time for one audit before failing open with `timeout`. |

**Key technical risks:**

| Risk | Impact | Mitigation |
|------|--------|------------|
| Real CDP endpoint varies per host / unknown at build time | Tool can't connect in prod | `cdpEndpoint` configurable; real wiring validated at deploy (out of scope here); unit tests don't need it |
| Runtime deps not present in container | Tool import fails at runtime | Declared in `dependencies`; OpenClaw installs plugin deps under `~/.openclaw/plugin-runtime-deps/`; dynamic-import keeps build/tests dep-free |
| A slow or hung page blocks the agent turn | Degraded agent | `timeoutMs` wraps the runner; fail open on timeout |
| axe-core / playwright-core version drift | Breakage on update | Pin to caret ranges in `dependencies` |

## Constraints (must-not)

- Do **not** commit any host-specific value: no `.lan` hostnames, LAN IPs, Tailscale names, Infisical IDs, or secrets in any file. The repo's pre-commit secret scan must pass.
- Do **not** deploy to, restart, or modify the live Juliet/thringle container as part of this work.
- The `a11y_audit` tool must **never throw out of the hook** — all failure paths return a structured `{ ok: false }` result.
- Do **not** bundle or launch a second browser; connect to the existing CDP Chromium via `connectOverCDP`.
- Do **not** commit `node_modules` (gitignored); the test path must not require installing third-party packages.
- Surgical scope: do not modify the sibling `pipeline-guard` / `sessions-worktree-injector` plugins.

## Data and safety

No persisted data is touched — the tool is stateless and writes nothing. No database, no migrations.

**Security:**
- Authentication / authorization: n/a — the tool runs inside the agent's own process under OpenClaw's existing tool-permission model; it adds no new external auth surface.
- Input validation: `validateInput` enforces url-XOR-html at the trust boundary before any browser action; `standard` is an enum.
- Encryption: n/a — CDP connection is to a local browser the host already runs; no new network exposure introduced by this plugin.
- Secrets: none. No API keys; nothing injected. The `cdpEndpoint` is a non-secret config value.
- Personal/external data: the tool fetches whatever `url` the agent points it at and runs axe locally; it does not transmit page content anywhere. No collection/sharing.

## Scope

### In scope (now)
- The native plugin: manifest, `package.json`, `index.ts`, `lib/audit.ts`.
- The `a11y_audit` tool: validation, standard mapping, CDP+axe runner with an injectable seam, result/error shaping, timeout, fail-open.
- The two ported skills (`accessibility`, `a11y-auditor`) with single-line frontmatter, references moved, the `rules/` correction table folded into the accessibility skill.
- The `node:test` harness and tests for every acceptance criterion.
- README for the plugin.

### Out of scope (deliberately deferred)
- Deploying/registering the plugin in the live Juliet container (machine-specific ops; done separately, off the public repo).
- Publishing to ClawHub or npm.
- Real-browser integration/end-to-end test against an actual CDP Chromium (unit tests mock the runner; live validation happens at deploy).
- Any change to `pipeline-guard` or other existing plugins.

## Testing

- **Unit (`node:test`):** every acceptance criterion above maps to a test in `index.test.ts`, run with `node --test` (native TS type-stripping on Node 22.6+; Node 26 on the build host). The browser runner is injected as a fake, so the suite needs no browser and no installed dependencies.
- **Static check on the skills:** `skill-scanner scan .../skills` must report SAFE (criterion `skill-scanner-safe`).
- **Lint/format/type:** `tsconfig.json` enables `tsc --noEmit` typecheck (optional gate); no linter is introduced (repo has none for these plugins).
- The real-browser path is exercised manually at deploy time, not in CI — stated in Out of scope.

## Dependencies

- **Depends on:** OpenClaw 2026.4.24 native plugin SDK (`setup(api)` + `api.registerTool`); at runtime, a reachable CDP Chromium and the `playwright-core` + `axe-core` packages (installed by OpenClaw's plugin runtime-deps mechanism).
- **Depended on by:** the `accessibility` and `a11y-auditor` skills, which call `a11y_audit`.

## Observability and done-in-production

This is an in-process tool, not a long-running service, so there is no Uptime Kuma monitor or ntfy alert. The runtime signal is the tool result itself: `ok: true` with a `summary`, or `ok: false` with an error code, plus `api.logger` warn lines on the failure paths. Post-deploy verification (out of scope here) is `openclaw plugins inspect openclaw-accessibility` showing `Format: native` with the `a11y_audit` tool, and `openclaw agent --message "audit example.com for accessibility"` returning a populated result.

## Open questions

- `[@humanUser]` The default `cdpEndpoint` (`http://127.0.0.1:9222`) is a placeholder for the build. The real endpoint of Juliet's managed Chromium is a deploy-time value set in plugin config; confirm it when installing (non-blocking for this spec — the build and tests do not need it).

---

## Implementation log / as-built

**Branch:** `pnk-baton/openclaw-accessibility-native-plugin` · **Status:** built, tested green (9/9), reviewed.
**Commits:** `d3d1fe0` test (red) → `0dc696c` feat. Documentation commit added on top.

### What actually shipped

15 new files, +4534 lines, all under `agents/openclaw/plugins/openclaw-accessibility/` (plus this spec in `backlog/`). No existing file was modified — sibling plugins (`pipeline-guard`, `sessions-worktree-injector`) untouched, as required by the surgical-scope constraint.

| File | Essence |
|------|---------|
| `index.ts` (111) | Default-export object with `setup(api)`; registers exactly one tool `a11y_audit`. Thin wiring over `lib/audit.ts`. `parameters` is a **plain JSON-Schema object literal**, not TypeBox. Two-layer fail-open: `execute()` already fails open, and the hook body wraps it in a try/catch returning `{ ok:false, error:"audit_failed" }` so it can never throw. Reads config from `api.pluginConfig` with hard-coded `DEFAULTS` fallback. |
| `lib/audit.ts` (321) | All logic, browser-free + fully exported: `validateInput` (url-XOR-html), `buildAxeOptions` (standard→axe tags, cumulative sets), `shapeResult`, `toErrorResult`, `createCdpRunner` (dynamic `import("playwright-core")`/`import("axe-core")` inside the body), `execute` (orchestrator with `withTimeout`, always resolves). |
| `index.test.ts` (313) | `node:test` suite, one test per acceptance criterion, fake `api` + fake runner. |
| `openclaw.plugin.json` (28) | Native manifest: `id`, `name`, `description`, `configSchema`, `"skills": ["./skills"]`. |
| `package.json` (15) | `type:module`, `openclaw.extensions:["./index.ts"]`, `axe-core ^4.10.2` + `playwright-core ^1.49.1` runtime deps, `scripts.test: "node --test"`. |
| `tsconfig.json` (15) | NodeNext ESM, editor/optional typecheck only. |
| `skills/accessibility/SKILL.md` + 6 `references/*.md` | Ported guidance; single-line frontmatter; body points at `a11y_audit` and the `a11y-auditor` skill. |
| `skills/a11y-auditor/SKILL.md` | Ported from the Claude `agents/a11y-auditor.md` subagent; Claude-only `model:`/`tools:` frontmatter dropped; single-line frontmatter; drives `a11y_audit` and produces a prioritized report. |
| `README.md` (54) | What it is, the tool, the two skills, install pointer only. |

### Key decisions / deviations from plan

- **No deviation from acceptance criteria** — all 10 criteria implemented as written. The two deliberate plan-honored choices that differ from the spec's *prose*: (a) `parameters` is a plain JSON-Schema literal, **not** TypeBox `Type.Object(...)` (the spec's Technical-approach text says TypeBox, but the zero-third-party-dependency test constraint wins; see Q2); (b) entry stays `setup(api)`+`api.registerTool` exactly as the criteria hard-code, with wiring kept thin so a rename to `register(api)` is a one-line change (see Q1).
- **Cumulative WCAG tag sets:** `WCAG2.1AAA` resolves to `["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag2aaa","wcag21aaa"]` (includes lower levels), matching axe-core convention. The `defaults-standard-wcag21aa` and `maps-standard-to-axe-tags` tests assert these exact sets.
- **Structured-error propagation through the seam:** `createCdpRunner` throws `toErrorResult(...)` objects (already `{ ok:false }`); `execute` detects an already-structured error and surfaces it verbatim, else wraps as `audit_failed`/`timeout`. Net effect: a single fail-open contract regardless of where the failure originates.

### Resolution of planner open questions

1. **ENTRY-SHAPE (`setup` vs `register`):** Kept `setup(api)` + `api.registerTool` as the criteria hard-code. Unit test `setup registers tool` passes against a fake `api`. The live-SDK shape is **unverified** (requires the running OpenClaw SDK, out of scope). Mitigation as planned: wiring in `setup()` is thin — if the deploy SDK calls `register` not `setup`, it is a one-line rename. **Deploy-time risk remains open.**
2. **TypeBox vs zero-dep:** Resolved in favour of zero-dep. `parameters`/`configSchema` are plain JSON-Schema object literals; the module loads with **no third-party packages installed**, which is what makes `node --test` dependency-free. If the real SDK strictly demands a TypeBox instance, that conversion happens at the deploy boundary (out of scope). **Confirm at install.**
3. **skill-scanner invocation:** Confirmed the criterion's literal command `skill-scanner scan .../skills` **does not work** — `scan` targets a single package and errors `SKILL.md not found` on the parent dir holding two skill packages. The working invocation is **`skill-scanner scan-all .../skills`** → `Skills Scanned: 2, Safe Skills: 2`, max severity **INFO** (1 info finding each), i.e. `[OK]` SAFE. Per-skill `skill-scanner scan .../skills/accessibility` also works. The skills are SAFE; the criterion's command string is the only thing that needed correcting.
4. **tsc unavailable:** Confirmed `tsc not found` in this environment; the tsconfig typecheck is editor/optional and is **not** a hard gate. `node --test` is the real gate and is green.
5. **cdpEndpoint default:** Left at the `http://127.0.0.1:9222` build placeholder; real Juliet Chromium endpoint is a deploy-time config value (the `[@humanUser]` open question above). Non-blocking for build/tests.

### Lessons / gotchas for a future maintainer

- **Run the tests from the plugin dir:** `cd agents/openclaw/plugins/openclaw-accessibility && node --test`. Requires Node ≥ 22.6 for native TS type-stripping (build host is Node 26).
- **Intra-repo imports carry an explicit `.ts` extension** (`./lib/audit.ts`) — Node strips types but does not rewrite extensions; dropping the extension breaks module resolution.
- **Never add a top-level `import` of `playwright-core`/`axe-core`** to `index.ts` or `lib/audit.ts` — that would make `node --test` require installed packages and break the dependency-free gate. They are imported lazily inside `createCdpRunner` only.
- **skill-scanner: use `scan-all` for this dir, not `scan`** (two packages under one parent).
- The CDP runner, timeout path, and real-browser end-to-end are **not** exercised by the suite (runner is mocked) — they are validated manually at deploy.

### How to verify

```
cd agents/openclaw/plugins/openclaw-accessibility
node --test                 # expect: 9 pass, 0 fail
skill-scanner scan-all skills   # expect: Skills Scanned 2, Safe 2, max severity INFO ([OK] SAFE)
```
"Good" = all 9 `node:test` cases pass and the scanner reports both skills SAFE. Typecheck (`tsc --noEmit`) is optional and unavailable here. Live-SDK load (`openclaw plugins inspect openclaw-accessibility` → `Format: native` with `a11y_audit`) is a deploy-time check, out of scope for this branch.
