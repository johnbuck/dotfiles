// lib/agentcore.ts
//
// The "agentcore" browser provider: start a short-lived AWS Bedrock AgentCore
// browser session per audit, hand back a CDP-connected Playwright browser, and
// stop the session on dispose. Because each audit mints and tears down its own
// session, the SigV4-expiry problem that bites long-lived static config does not
// apply — auditing is one-shot.
//
// Everything AWS is dynamic-import()ed inside startAgentCoreSession so the cdp
// provider (and the test suite) never load AWS packages. They are declared in
// package.json optionalDependencies; an AgentCore deployment installs them. The
// top of this file imports only from ./audit.ts (no third-party), so the pure
// buildAutomationUrl helper is unit-testable with nothing installed.
//
// VERIFY-AGAINST-LIVE: the StartBrowserSession / StopBrowserSession field names
// and the presign-vs-headers choice are written from AWS's documented CDP
// automation URL format. Confirm against the Prodigy browser-mcp BrowserClient
// snippet before production use — the lifecycle structure is the stable part.

import type { AgentCoreConfig, BrowserSession, RunnerContext } from "./audit.ts";
import { toErrorResult } from "./audit.ts";

const DEFAULT_IDENTIFIER = "aws.browser.v1";
const DEFAULT_SESSION_TIMEOUT_SECONDS = 300;
const SIGV4_SERVICE = "bedrock-agentcore";

// buildAutomationUrl — the CDP automation WebSocket URL for a session. Pure +
// exported for unit tests. Format per AWS docs:
//   https://bedrock-agentcore.<region>.amazonaws.com/browser-streams/<browserId>/sessions/<sessionId>/automation
export function buildAutomationUrl(region: string, browserId: string, sessionId: string): string {
  return (
    `https://bedrock-agentcore.${region}.amazonaws.com` +
    `/browser-streams/${browserId}/sessions/${sessionId}/automation`
  );
}

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
  const region = ac.region;
  const identifier = ac.identifier ?? DEFAULT_IDENTIFIER;
  const sessionTimeoutSeconds = ac.sessionTimeoutSeconds ?? DEFAULT_SESSION_TIMEOUT_SECONDS;

  // Lazy AWS imports — only loaded for the agentcore provider.
  let AgentCore: any, SignatureV4: any, Sha256: any, defaultProvider: any, chromium: any;
  try {
    ({ chromium } = (await import("playwright-core")) as any);
    AgentCore = await import("@aws-sdk/client-bedrock-agentcore");
    ({ SignatureV4 } = (await import("@aws-sdk/signature-v4")) as any);
    ({ Sha256 } = (await import("@aws-crypto/sha256-js")) as any);
    ({ defaultProvider } = (await import("@aws-sdk/credential-provider-node")) as any);
  } catch (err) {
    throw toErrorResult(
      new Error(
        "agentcore provider needs AWS deps installed: @aws-sdk/client-bedrock-agentcore, " +
          "@aws-sdk/signature-v4, @aws-crypto/sha256-js, @aws-sdk/credential-provider-node " +
          `(${err instanceof Error ? err.message : String(err)})`,
      ),
      { code: "browser_unavailable", standard: ctx.standard, target: ctx.target },
    );
  }

  const client = new AgentCore.BedrockAgentCoreClient({ region });

  // 1. Start a session.  VERIFY field names against the live SDK / your snippet.
  let sessionId: string;
  let browserId: string;
  try {
    const res = await client.send(
      new AgentCore.StartBrowserSessionCommand({
        browserIdentifier: identifier,
        sessionTimeoutSeconds,
      }),
    );
    sessionId = res.sessionId;
    browserId = res.browserIdentifier ?? identifier;
  } catch (err) {
    throw toErrorResult(err, { code: "browser_unavailable", standard: ctx.standard, target: ctx.target });
  }

  // 2. SigV4-presign the CDP automation URL with the agent's ambient credentials.
  let presignedUrl: string;
  try {
    const u = new URL(buildAutomationUrl(region, browserId, sessionId));
    const signer = new SignatureV4({
      service: SIGV4_SERVICE,
      region,
      credentials: defaultProvider(),
      sha256: Sha256,
    });
    const signed = await signer.presign(
      { method: "GET", protocol: u.protocol, hostname: u.hostname, path: u.pathname, headers: { host: u.hostname } },
      { expiresIn: 300 },
    );
    const qs = new URLSearchParams(signed.query as Record<string, string>).toString();
    presignedUrl = `wss://${u.hostname}${u.pathname}?${qs}`;
  } catch (err) {
    await stopSession(client, AgentCore, browserId, sessionId);
    throw toErrorResult(err, { code: "browser_unavailable", standard: ctx.standard, target: ctx.target });
  }

  // 3. Connect Playwright to the presigned CDP socket.
  let browser: any;
  try {
    const opts: any = {};
    if (config.connectTimeoutMs && config.connectTimeoutMs > 0) opts.timeout = config.connectTimeoutMs;
    browser = await chromium.connectOverCDP(presignedUrl, opts);
  } catch (err) {
    await stopSession(client, AgentCore, browserId, sessionId);
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
      await stopSession(client, AgentCore, browserId, sessionId);
    },
  };
}

async function stopSession(client: any, AgentCore: any, browserId: string, sessionId: string): Promise<void> {
  try {
    await client.send(new AgentCore.StopBrowserSessionCommand({ browserIdentifier: browserId, sessionId }));
  } catch {
    /* best effort — the session TTL reaps it anyway */
  }
}
