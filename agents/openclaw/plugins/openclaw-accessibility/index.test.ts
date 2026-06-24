// node:test suite for the openclaw-accessibility native plugin.
//
// These tests encode the spec's acceptance criteria as an executable
// contract. They are written test-first: the implementation
// (./lib/audit.ts, ./index.ts, ./openclaw.plugin.json and the two
// skills/.../SKILL.md files) does not exist yet, so every test here
// fails until the builder implements the contract.
//
// Run from this directory with ZERO third-party packages installed:
//   node --test
//
// Node 26 strips TypeScript types natively, so the .ts modules load
// without a build step. Intra-repo ESM imports MUST carry an explicit
// `.ts` extension (Node does not rewrite extensions).
//
// Module helpers are loaded with a *dynamic* import inside each test so
// a missing module surfaces as that test's own failure (the function /
// behaviour is missing) rather than a single file-load crash.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;

// Load the pure-helper module under test. In the red phase this throws
// (module absent) — that IS the expected failure: the behaviour is missing.
async function loadAudit(): Promise<any> {
  return await import("./lib/audit.ts");
}

// Load the plugin entry (default export with register(api)).
async function loadIndex(): Promise<any> {
  const mod = await import("./index.ts");
  return mod.default ?? mod;
}

// Extract the axe tag list from whatever options shape buildAxeOptions
// returns. axe-core's canonical run-options carry the tags under
// runOnly.values; accept a couple of equivalent shapes so the contract
// is about the TAGS, not the wrapper. Returns undefined if no tag list
// is found (which makes the asserting test fail, as intended).
function tagsOf(opts: any): string[] | undefined {
  if (!opts || typeof opts !== "object") return undefined;
  if (opts.runOnly && Array.isArray(opts.runOnly.values)) return opts.runOnly.values;
  if (Array.isArray(opts.tags)) return opts.tags;
  if (Array.isArray(opts.values)) return opts.values;
  return undefined;
}

// Read a SKILL.md frontmatter block (between the first two `---` fences).
function readFrontmatter(absPath: string): string {
  const text = readFileSync(absPath, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) {
    throw new Error(`no YAML frontmatter block found in ${absPath}`);
  }
  return m[1];
}

// ---------------------------------------------------------------------------
// Criterion: requires-url-or-html
//   input with neither url nor html → { ok:false, error:"invalid_input" }
//   and the runner is NOT called.

test("validateInput rejects empty", async () => {
  const { validateInput, execute } = await loadAudit();

  const v = validateInput({});
  assert.equal(v.ok, false, "validateInput({}) must be ok:false");
  assert.equal(v.error, "invalid_input", 'error must be "invalid_input"');

  // execute() must short-circuit before touching the runner seam.
  let runnerCalled = false;
  const recordingRunner = async () => {
    runnerCalled = true;
    return {};
  };
  const r = await execute({}, recordingRunner);
  assert.equal(runnerCalled, false, "runner must NOT be called for invalid input");
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_input");
});

// ---------------------------------------------------------------------------
// Criterion: rejects-url-and-html (url XOR html)
//   input with both url and html → { ok:false, error:"invalid_input" }.

test("validateInput rejects both", async () => {
  const { validateInput } = await loadAudit();

  const v = validateInput({ url: "https://example.com", html: "<p>hi</p>" });
  assert.equal(v.ok, false, "supplying both url and html must be rejected");
  assert.equal(v.error, "invalid_input");

  // Control: exactly one of url/html is accepted.
  assert.equal(validateInput({ url: "https://example.com" }).ok, true);
  assert.equal(validateInput({ html: "<p>hi</p>" }).ok, true);
});

// ---------------------------------------------------------------------------
// Criterion: defaults-standard-wcag21aa
//   omitting `standard` → the WCAG2.1AA axe tag set.

test("buildAxeOptions default", async () => {
  const { buildAxeOptions } = await loadAudit();

  const tags = tagsOf(buildAxeOptions());
  assert.ok(tags, "buildAxeOptions() must yield a recognizable axe tag list");
  assert.deepEqual(
    tags,
    ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    "default (WCAG2.1AA) tag set mismatch",
  );
});

// ---------------------------------------------------------------------------
// Criterion: maps-standard-to-axe-tags
//   standard "WCAG2.1AAA" → the AAA tag set (A + AA + AAA across 2.0/2.1).

test("buildAxeOptions AAA", async () => {
  const { buildAxeOptions } = await loadAudit();

  const tags = tagsOf(buildAxeOptions("WCAG2.1AAA"));
  assert.ok(tags, "buildAxeOptions('WCAG2.1AAA') must yield a tag list");

  // Must contain the AAA-distinguishing tags...
  assert.ok(tags.includes("wcag2aaa"), "AAA set must include wcag2aaa");
  assert.ok(tags.includes("wcag21aaa"), "AAA set must include wcag21aaa");

  // ...be the canonical cumulative AAA set (order-independent)...
  assert.deepEqual(
    [...tags].sort(),
    ["wcag21a", "wcag21aa", "wcag21aaa", "wcag2a", "wcag2aa", "wcag2aaa"].sort(),
    "AAA tag set mismatch",
  );

  // ...and must differ from the default AA set.
  const defaultTags = tagsOf(buildAxeOptions());
  assert.notDeepEqual([...tags].sort(), [...(defaultTags ?? [])].sort());
});

// ---------------------------------------------------------------------------
// Criterion: remote-auth-passthrough
//   buildConnectArgs forwards optional auth headers + connect timeout to
//   connectOverCDP, so the runner can attach to a remote/authenticated browser
//   (e.g. AWS Bedrock AgentCore Browser's wss:// CDP endpoint). Nothing is
//   host-specific: endpoint + headers are pure inputs.

test("buildConnectArgs forwards endpoint, headers, timeout", async () => {
  const { buildConnectArgs } = await loadAudit();

  // Bare local connect: no headers, no timeout -> empty options.
  const [ep1, opt1] = buildConnectArgs("http://127.0.0.1:9222");
  assert.equal(ep1, "http://127.0.0.1:9222");
  assert.deepEqual(opt1, {}, "local connect must stay a bare call (no options)");

  // Remote authenticated connect: wss endpoint + signed headers are passed through.
  const wss = "wss://bedrock-agentcore.example/cdp";
  const headers = { Authorization: "AWS4-HMAC-SHA256 ...", "X-Amz-Date": "20260623T000000Z" };
  const [ep2, opt2] = buildConnectArgs(wss, headers, 15000);
  assert.equal(ep2, wss, "endpoint passed through verbatim (wss supported)");
  assert.deepEqual(opt2.headers, headers, "auth headers must reach connectOverCDP");
  assert.equal(opt2.timeout, 15000, "connect timeout must be forwarded");

  // Empty header map is omitted (not sent as {}).
  const [, opt3] = buildConnectArgs(wss, {}, 0);
  assert.equal("headers" in opt3, false, "empty headers must be omitted");
  assert.equal("timeout" in opt3, false, "zero/unset timeout must be omitted");
});

// ---------------------------------------------------------------------------
// Criterion: waitUntil-configurable
//   resolveWaitUntil validates the configured navigation wait condition and
//   defaults to "load" for anything unrecognized.

test("resolveWaitUntil validates and defaults", async () => {
  const { resolveWaitUntil } = await loadAudit();
  assert.equal(resolveWaitUntil(), "load", "default is load");
  assert.equal(resolveWaitUntil("networkidle"), "networkidle");
  assert.equal(resolveWaitUntil("domcontentloaded"), "domcontentloaded");
  assert.equal(resolveWaitUntil("bogus"), "load", "unknown value falls back to load");
});

// ---------------------------------------------------------------------------
// Criterion: provider-selection
//   createRunnerFromConfig returns a runner for either provider; cdp is default.

test("createRunnerFromConfig selects a provider", async () => {
  const { createRunnerFromConfig } = await loadAudit();
  assert.equal(typeof createRunnerFromConfig(), "function", "default (mcp) runner");
  assert.equal(typeof createRunnerFromConfig({ browserProvider: "cdp" }), "function", "cdp runner");
  assert.equal(
    typeof createRunnerFromConfig({ browserProvider: "agentcore", agentcore: { region: "us-east-1" } }),
    "function",
    "agentcore runner",
  );
});

// ---------------------------------------------------------------------------
// Criterion: agentcore-fails-open
//   The agentcore provider fails open (no AWS packages required) when its
//   mandatory region config is missing — execute resolves { ok:false } and never
//   throws. Proves the provider wiring + fail-open without touching AWS.

test("agentcore provider fails open on missing region", async () => {
  const { execute, createRunnerFromConfig } = await loadAudit();
  const runner = createRunnerFromConfig({ browserProvider: "agentcore" }); // no agentcore.region
  const r = await execute({ html: "<button></button>" }, runner);
  assert.equal(r.ok, false, "missing region must fail, not audit");
  assert.equal(r.error, "browser_unavailable");
});

// ---------------------------------------------------------------------------
// Criterion: mcp-dispatch-sequence
//   runAxeViaMcp drives the existing browser MCP tools in order — navigate,
//   inject axe (script = source), run axe (script = window.axe.run) — and parses
//   the returned JSON string. Uses a fake callTool; no browser, no axe-core.

test("runAxeViaMcp drives navigate + inject + run and parses JSON", async () => {
  const { runAxeViaMcp } = await loadAudit();
  const calls: any[] = [];
  const axeJson = JSON.stringify({
    violations: [{ id: "button-name", impact: "critical", help: "h", helpUrl: "u", nodes: [] }],
    passes: [],
    incomplete: [],
  });
  const callTool = async (server: string, tool: string, input: any) => {
    calls.push({ server, tool, input });
    return tool === "browser_evaluate" && /window\.axe\.run/.test(input.script) ? axeJson : "";
  };
  const ctx = {
    url: "https://example.com",
    standard: "WCAG2.1AA",
    target: "https://example.com",
    axeOptions: { runOnly: { type: "tag", values: ["wcag2a"] } },
  };
  const raw = await runAxeViaMcp(
    callTool,
    { serverName: "browser", navigateTool: "browser_navigate", evaluateTool: "browser_evaluate" },
    ctx,
    "AXE_SOURCE_STR",
  );
  assert.equal(calls[0].tool, "browser_navigate");
  assert.deepEqual(calls[0].input, { url: "https://example.com" });
  assert.equal(calls[1].tool, "browser_evaluate");
  assert.equal(calls[1].input.script, "AXE_SOURCE_STR", "axe source injected verbatim");
  assert.match(calls[2].input.script, /window\.axe\.run/, "second eval runs axe");
  assert.equal(raw.violations[0].id, "button-name", "JSON-string result is parsed");
});

test("runAxeViaMcp audits html via a data: URL (no setContent)", async () => {
  const { runAxeViaMcp } = await loadAudit();
  let navUrl = "";
  const callTool = async (_s: string, t: string, i: any) => {
    if (t === "browser_navigate") navUrl = i.url;
    return "{}";
  };
  const ctx = {
    html: "<button></button>",
    standard: "WCAG2.1AA",
    target: "<inline html>",
    axeOptions: { runOnly: { type: "tag", values: [] } },
  };
  await runAxeViaMcp(
    callTool,
    { serverName: "b", navigateTool: "browser_navigate", evaluateTool: "browser_evaluate" },
    ctx,
    "AXE",
  );
  assert.match(navUrl, /^data:text\/html/, "html audited via data: URL");
  assert.match(navUrl, /%3Cbutton/, "html is URL-encoded into the data URL");
});

test("extractAxeJson unwraps strings and MCP content arrays", async () => {
  const { extractAxeJson } = await loadAudit();
  assert.deepEqual(extractAxeJson('{"a":1}'), { a: 1 }, "plain JSON string");
  assert.deepEqual(extractAxeJson({ content: [{ type: "text", text: '{"b":2}' }] }), { b: 2 }, "MCP content array");
  assert.deepEqual(extractAxeJson({ text: '{"c":3}' }), { c: 3 }, "{ text }");
  assert.deepEqual(extractAxeJson({ d: 4 }), { d: 4 }, "object passthrough");
});

test("mcp provider fails open without a callTool handle", async () => {
  const { execute, createRunnerFromConfig } = await loadAudit();
  // default provider is mcp; api has no runtime.callTool
  const runner = createRunnerFromConfig({ mcp: { serverName: "browser" } }, { logger: {} });
  const r = await execute({ url: "https://example.com" }, runner);
  assert.equal(r.ok, false);
  assert.equal(r.error, "browser_unavailable");
});

test("mcp provider fails open without serverName", async () => {
  const { execute, createRunnerFromConfig } = await loadAudit();
  const fakeApi = { runtime: { callTool: async () => "" } };
  const runner = createRunnerFromConfig({ browserProvider: "mcp" }, fakeApi); // no mcp.serverName
  const r = await execute({ url: "https://example.com" }, runner);
  assert.equal(r.ok, false);
  assert.equal(r.error, "browser_unavailable");
});

// ---------------------------------------------------------------------------
// Criterion: shapes-violations
//   shapeResult on a canned axe result → summary.violations == count and
//   violations[].{id,impact,help,helpUrl,nodes} populated.

test("shapeResult maps fields", async () => {
  const { shapeResult } = await loadAudit();

  const cannedAxeRaw = {
    violations: [
      {
        id: "button-name",
        impact: "critical",
        help: "Buttons must have discernible text",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.x/button-name",
        nodes: [{ target: ["button:nth-child(1)"], html: "<button></button>" }],
      },
      {
        id: "image-alt",
        impact: "serious",
        help: "Images must have alternate text",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.x/image-alt",
        nodes: [{ target: ["img"], html: "<img src=x>" }],
      },
    ],
    passes: [{ id: "document-title" }],
    incomplete: [{ id: "color-contrast" }],
  };

  const shaped = shapeResult(cannedAxeRaw, {
    standard: "WCAG2.1AA",
    target: "https://example.com",
  });

  assert.equal(shaped.ok, true);
  assert.equal(
    shaped.summary.violations,
    2,
    "summary.violations must equal the violation count",
  );
  assert.equal(shaped.violations.length, 2);

  for (const v of shaped.violations) {
    assert.ok(typeof v.id === "string" && v.id.length > 0, "violation.id populated");
    assert.ok(typeof v.impact === "string" && v.impact.length > 0, "violation.impact populated");
    assert.ok(typeof v.help === "string" && v.help.length > 0, "violation.help populated");
    assert.ok(
      typeof v.helpUrl === "string" && v.helpUrl.length > 0,
      "violation.helpUrl populated",
    );
    assert.ok(Array.isArray(v.nodes) && v.nodes.length > 0, "violation.nodes populated");
  }

  // First violation keeps its identity through shaping.
  assert.equal(shaped.violations[0].id, "button-name");
  assert.equal(shaped.violations[0].impact, "critical");
});

// ---------------------------------------------------------------------------
// Criterion: fails-open-on-runner-error
//   injected runner throws → execute resolves to { ok:false, error:"audit_failed" }
//   and NEVER rejects.

test("execute fails open", async () => {
  const { execute } = await loadAudit();

  const throwingRunner = async () => {
    throw new Error("boom: CDP exploded");
  };

  let result: any;
  let rejected = false;
  try {
    result = await execute({ url: "https://example.com" }, throwingRunner);
  } catch {
    rejected = true;
  }

  assert.equal(rejected, false, "execute must never reject — it fails open");
  assert.equal(result.ok, false);
  assert.equal(result.error, "audit_failed", 'runner throw must map to "audit_failed"');
});

// ---------------------------------------------------------------------------
// Criterion: registers-a11y-audit-tool
//   register(api) calls api.registerTool exactly once with name "a11y_audit"
//   and a parameters schema exposing url, html, standard.
//   (Lifecycle method is `register`, matching the in-repo sibling plugins and
//   the live OpenClaw SDK convention — every in-tree tool extension uses it.)

test("register registers tool", async () => {
  const plugin = await loadIndex();
  assert.equal(typeof plugin.register, "function", "default export must expose register(api)");

  const registered: any[] = [];
  const fakeApi = {
    registerTool: (def: any) => {
      registered.push(def);
    },
    pluginConfig: {},
    config: {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    on() {},
  };

  await plugin.register(fakeApi);

  assert.equal(registered.length, 1, "registerTool must be called exactly once");
  const def = registered[0];
  assert.equal(def.name, "a11y_audit", 'tool name must be "a11y_audit"');
  assert.equal(typeof def.execute, "function", "tool must supply an execute()");

  const props = def.parameters?.properties ?? {};
  for (const key of ["url", "html", "standard"]) {
    assert.ok(key in props, `parameters schema must expose "${key}"`);
  }
});

// ---------------------------------------------------------------------------
// Criterion: manifest-is-native
//   openclaw.plugin.json parses and has id, name, description, configSchema,
//   and "skills": ["./skills"].

test("manifest shape", () => {
  const raw = readFileSync(path.join(HERE, "openclaw.plugin.json"), "utf8");
  const manifest = JSON.parse(raw);

  assert.equal(typeof manifest.id, "string");
  assert.ok(manifest.id.length > 0, "id must be non-empty");
  assert.equal(typeof manifest.name, "string");
  assert.ok(manifest.name.length > 0, "name must be non-empty");
  assert.equal(typeof manifest.description, "string");
  assert.ok(manifest.description.length > 0, "description must be non-empty");
  assert.equal(typeof manifest.configSchema, "object");
  assert.ok(manifest.configSchema !== null, "configSchema must be an object");
  assert.deepEqual(manifest.skills, ["./skills"], 'skills must be ["./skills"]');
});

// ---------------------------------------------------------------------------
// Criterion: skills-frontmatter-single-line
//   both SKILL.md files have single-line name: and description: frontmatter
//   (no `|` / `>` block scalar on those keys).

test("skill frontmatter single-line", () => {
  const skillFiles = [
    path.join(HERE, "skills", "accessibility", "SKILL.md"),
    path.join(HERE, "skills", "a11y-auditor", "SKILL.md"),
  ];

  for (const file of skillFiles) {
    const fm = readFrontmatter(file);

    for (const key of ["name", "description"]) {
      // Find the `key:` line in the frontmatter.
      const line = fm
        .split(/\r?\n/)
        .find((l) => new RegExp(`^${key}\\s*:`).test(l));
      assert.ok(line, `${file}: frontmatter must define "${key}:"`);

      // The value must be inline on the same line — reject block scalars.
      const value = line!.replace(new RegExp(`^${key}\\s*:\\s*`), "");
      assert.ok(
        !/^[|>]/.test(value),
        `${file}: "${key}" must be a single-line scalar, not a | / > block scalar`,
      );
      assert.ok(
        value.trim().length > 0,
        `${file}: "${key}" must have an inline value on the same line`,
      );
    }
  }
});
