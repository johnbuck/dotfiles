// openclaw-accessibility
//
// Native OpenClaw plugin that registers the `a11y_audit` tool: it runs
// axe-core against a web page (or a raw HTML string) over a CDP-reachable
// Chromium and returns structured WCAG findings. The browser may be local
// or remote/managed (e.g. AWS Bedrock AgentCore Browser) — the endpoint and
// any auth headers are plugin config, so nothing here is host-specific.
//
// This file is thin wiring. All logic lives in ./lib/audit.ts so it can be
// unit-tested browser-free. The default export exposes register(api), which
// registers exactly one tool. `parameters` is a plain JSON-Schema object
// literal (not a TypeBox import) so the module loads with zero third-party
// packages installed — the node:test suite depends on that.
//
// Intra-repo import carries an explicit `.ts` extension (Node 26 strips
// types but does not rewrite extensions).

import { execute, createCdpRunner } from "./lib/audit.ts";

const DEFAULTS = {
  cdpEndpoint: "http://127.0.0.1:9222",
  defaultStandard: "WCAG2.1AA",
  timeoutMs: 30000,
  connectTimeoutMs: 30000,
};

export default {
  id: "openclaw-accessibility",
  name: "OpenClaw Accessibility",
  description:
    "Registers the a11y_audit tool: runs axe-core against a page or HTML string over a CDP-reachable Chromium (local or remote/managed, e.g. AWS Bedrock AgentCore Browser) and returns structured WCAG violations. Ships the accessibility and a11y-auditor skills that drive it.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      cdpEndpoint: {
        type: "string",
        default: DEFAULTS.cdpEndpoint,
        description:
          "CDP endpoint to attach to. http(s):// for a local browser, or ws(s):// for a remote/managed browser (e.g. AWS Bedrock AgentCore Browser). Set per agent at deploy.",
      },
      cdpHeaders: {
        type: "object",
        additionalProperties: { type: "string" },
        description:
          "Optional HTTP headers sent on the CDP connect handshake. Use for a browser that authenticates the CDP socket (e.g. AgentCore's signed Authorization headers). Omit for a local browser.",
      },
      connectTimeoutMs: {
        type: "number",
        default: DEFAULTS.connectTimeoutMs,
        description: "Timeout for the CDP connect handshake.",
      },
      defaultStandard: {
        type: "string",
        enum: ["WCAG2.0AA", "WCAG2.1AA", "WCAG2.1AAA", "best-practice"],
        default: DEFAULTS.defaultStandard,
        description: "axe standard used when a call omits `standard`.",
      },
      timeoutMs: {
        type: "number",
        default: DEFAULTS.timeoutMs,
        description: "Max time for one audit before failing open with `timeout`.",
      },
    },
  },

  register(api: any) {
    const cfg = api?.pluginConfig ?? {};
    const cdpEndpoint = cfg.cdpEndpoint ?? DEFAULTS.cdpEndpoint;
    const cdpHeaders = cfg.cdpHeaders ?? undefined;
    const connectTimeoutMs = cfg.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs;
    const defaultStandard = cfg.defaultStandard ?? DEFAULTS.defaultStandard;
    const timeoutMs = cfg.timeoutMs ?? DEFAULTS.timeoutMs;

    const runner = createCdpRunner({ cdpEndpoint, cdpHeaders, connectTimeoutMs });

    api.registerTool({
      name: "a11y_audit",
      label: "Accessibility Audit",
      description:
        "Audit a web page (url) or raw HTML (html) against a WCAG standard using axe-core. " +
        "Returns { ok, standard, target, summary, violations } or a structured { ok:false, error } on failure.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: {
            type: "string",
            description: "URL of the page to audit. Provide exactly one of url or html.",
          },
          html: {
            type: "string",
            description: "Raw HTML string to audit. Provide exactly one of url or html.",
          },
          standard: {
            type: "string",
            enum: ["WCAG2.0AA", "WCAG2.1AA", "WCAG2.1AAA", "best-practice"],
            description: `WCAG standard to audit against (default ${defaultStandard}).`,
          },
        },
      },
      async execute(_toolCallId: string, params: any) {
        const merged = {
          ...params,
          standard: params?.standard ?? defaultStandard,
        };
        try {
          return await execute(merged, runner, { cdpEndpoint, timeoutMs });
        } catch (err: any) {
          // Defence in depth: execute() already fails open, but the hook must
          // never throw. Return a structured error instead.
          api?.logger?.warn?.(
            `a11y_audit: unexpected error: ${err?.message ?? String(err)}`,
          );
          return {
            ok: false,
            error: "audit_failed",
            message: err?.message ?? String(err),
          };
        }
      },
    });

    api?.logger?.info?.(
      `openclaw-accessibility: registered a11y_audit (cdp=${cdpEndpoint}, default=${defaultStandard})`,
    );
  },
};
