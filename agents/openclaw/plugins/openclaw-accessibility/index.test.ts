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

// Load the plugin entry (default export with setup(api)).
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
//   setup(api) calls api.registerTool exactly once with name "a11y_audit"
//   and a parameters schema exposing url, html, standard.

test("setup registers tool", async () => {
  const plugin = await loadIndex();
  assert.equal(typeof plugin.setup, "function", "default export must expose setup(api)");

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

  await plugin.setup(fakeApi);

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
