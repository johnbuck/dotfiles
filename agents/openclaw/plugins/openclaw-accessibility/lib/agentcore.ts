// lib/agentcore.ts
//
// The "agentcore" browser provider: start a short-lived AWS Bedrock AgentCore
// browser session per audit, hand back a CDP-connected Playwright browser, and
// stop the session on dispose. Because each audit mints and tears down its own
// session, the SigV4-expiry problem that bites long-lived static config does not
// apply — auditing is one-shot.
//
// Uses the official `bedrock-agentcore` TypeScript SDK Browser client. Its
// generateWebSocketUrl() returns { url, headers } — the CDP automation wss URL
// plus the SigV4 auth headers — exactly like the Python
// BrowserClient.generate_ws_headers() the production browser-mcp uses. So there
// is no manual SigV4 and no control-plane field-name risk; the SDK tracks both.
//
// Lifecycle mirrors the production browser-mcp:
//   new Browser({region, identifier}) -> startSession({timeout, viewport})
//   -> generateWebSocketUrl() -> connectOverCDP(url, {headers}) -> audit
//   -> browser.close() -> stopSession()
//
// AWS imports are dynamic so the cdp provider and the test suite load nothing.
// `bedrock-agentcore` is declared in package.json optionalDependencies. IAM auth
// is ambient (the agent's role / Principal ARN) via the SDK's default credential
// provider chain — nothing is passed in plugin config.

import type { AgentCoreConfig, BrowserSession, RunnerContext } from "./audit.ts";
import { toErrorResult } from "./audit.ts";

const DEFAULT_SESSION_TIMEOUT_SECONDS = 3600;

export async function startAgentCoreSession(
  config: { agentcore?: AgentCoreConfig; connectTimeoutMs?: number },
  ctx: RunnerContext,
): Promise<BrowserSession> {
  const ac = config.agentcore;
  if (!ac || !ac.region) {
    throw toErrorResult(new Error('browserProvider "agentcore" requires agentcore.region'), {
      code: "browser_unavailable",
      standard: ctx.standard,
      target: ctx.target,
    });
  }

  // Lazy imports — only loaded for the agentcore provider.
  let Browser: any;
  let chromium: any;
  try {
    ({ chromium } = (await import("playwright-core")) as any);
    ({ Browser } = (await import("bedrock-agentcore/browser")) as any);
  } catch (err) {
    throw toErrorResult(
      new Error(
        "agentcore provider needs `bedrock-agentcore` and `playwright-core` installed " +
          `(${err instanceof Error ? err.message : String(err)})`,
      ),
      { code: "browser_unavailable", standard: ctx.standard, target: ctx.target },
    );
  }

  // identifier omitted -> SDK default 'aws.browser.v1'. Credentials are ambient.
  const client = new Browser({
    region: ac.region,
    ...(ac.identifier ? { identifier: ac.identifier } : {}),
  });

  // 1. Start a session.
  try {
    await client.startSession({
      timeout: ac.sessionTimeoutSeconds ?? DEFAULT_SESSION_TIMEOUT_SECONDS,
      ...(ac.viewport ? { viewport: ac.viewport } : {}),
    });
  } catch (err) {
    throw toErrorResult(err, { code: "browser_unavailable", standard: ctx.standard, target: ctx.target });
  }

  // 2. Get the CDP automation URL + signed headers, then connect Playwright.
  let browser: any;
  try {
    const { url, headers } = await client.generateWebSocketUrl();
    const opts: any = { headers };
    if (config.connectTimeoutMs && config.connectTimeoutMs > 0) opts.timeout = config.connectTimeoutMs;
    browser = await chromium.connectOverCDP(url, opts);
  } catch (err) {
    await stopSession(client);
    throw toErrorResult(err, { code: "browser_unavailable", standard: ctx.standard, target: ctx.target });
  }

  return {
    browser,
    dispose: async () => {
      try {
        await browser.close();
      } catch {
        /* best effort */
      }
      await stopSession(client);
    },
  };
}

// stopSession releases the AgentCore session — must not be skipped. Best-effort:
// the session TTL reaps it if this fails.
async function stopSession(client: any): Promise<void> {
  try {
    await client.stopSession();
  } catch {
    /* best effort */
  }
}
