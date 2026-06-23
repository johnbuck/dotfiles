// lib/audit.ts
//
// Pure, browser-free helpers for the a11y_audit tool plus the injectable
// CDP+axe runner seam. Everything here is exported so the node:test suite
// can exercise each acceptance criterion without a browser:
//
//   validateInput     — url-XOR-html trust-boundary check (pure)
//   buildAxeOptions   — WCAG standard -> axe tag set (pure)
//   shapeResult       — raw axe output -> { ok, standard, target, summary, violations } (pure)
//   toErrorResult     — error -> structured { ok:false, error, message, ... } (pure)
//   createCdpRunner   — factory for the real runner; uses dynamic import() inside
//                       so build/tests stay dependency-free
//   execute           — orchestrates validate -> buildAxeOptions -> runner -> shapeResult,
//                       always resolves to { ok:... }, never throws (fails open)
//
// No top-level third-party import: Node 26 type-strips this .ts and loads it
// with zero installed packages. Intra-repo ESM imports carry explicit `.ts`.

// ---------------------------------------------------------------------------
// Types (local; no SDK import).

export type Standard = "WCAG2.0AA" | "WCAG2.1AA" | "WCAG2.1AAA" | "best-practice";

export interface AuditParams {
  url?: string;
  html?: string;
  standard?: string;
}

export interface ValidationOk {
  ok: true;
  url?: string;
  html?: string;
}

export interface ErrorResult {
  ok: false;
  error: string;
  message: string;
  standard?: string;
  target?: string;
}

export type ErrorCode =
  | "invalid_input"
  | "browser_unavailable"
  | "navigation_failed"
  | "audit_failed"
  | "timeout";

// The runner seam. Receives the resolved audit context and returns the raw
// axe-core result object ({ violations, passes, incomplete, ... }).
export interface RunnerContext {
  url?: string;
  html?: string;
  target: string;
  standard: string;
  axeOptions: AxeRunOptions;
}

export type Runner = (ctx: RunnerContext) => Promise<any>;

export interface AxeRunOptions {
  runOnly: { type: "tag"; values: string[] };
}

export interface RunnerConfig {
  // CDP endpoint to attach to. Accepts http(s):// (Playwright discovers the ws
  // endpoint via /json/version) or ws(s):// (connected directly). A remote or
  // managed browser — e.g. AWS Bedrock AgentCore Browser — is just a wss:// URL.
  cdpEndpoint?: string;
  // Optional headers for the CDP connect handshake. Required by remote/managed
  // browsers that authenticate the CDP socket (e.g. AWS Bedrock AgentCore
  // Browser serves a wss:// endpoint with signed auth headers). Omit for a
  // local browser that needs no auth.
  cdpHeaders?: Record<string, string>;
  // Timeout for the CDP connect handshake (ms). Separate from the per-audit
  // timeoutMs that wraps the whole run.
  connectTimeoutMs?: number;
  defaultStandard?: string;
  timeoutMs?: number;
}

// buildConnectArgs — assemble the (endpointURL, options) arguments for
// playwright's connectOverCDP. Pure and exported so the header/timeout plumbing
// (the part that makes a remote/authenticated browser work) is unit-testable
// without a browser. Empty headers / unset timeout are omitted so a plain local
// connect stays a bare call.
export function buildConnectArgs(
  endpoint: string,
  headers?: Record<string, string>,
  connectTimeoutMs?: number,
): [string, { headers?: Record<string, string>; timeout?: number }] {
  const options: { headers?: Record<string, string>; timeout?: number } = {};
  if (headers && Object.keys(headers).length > 0) options.headers = headers;
  if (typeof connectTimeoutMs === "number" && connectTimeoutMs > 0) {
    options.timeout = connectTimeoutMs;
  }
  return [endpoint, options];
}

// ---------------------------------------------------------------------------
// Standard -> axe tag set. Cumulative (each level includes the lower ones).

const STANDARD_TAGS: Record<Standard, string[]> = {
  "WCAG2.0AA": ["wcag2a", "wcag2aa"],
  "WCAG2.1AA": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  "WCAG2.1AAA": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag2aaa", "wcag21aaa"],
  "best-practice": ["best-practice"],
};

export const DEFAULT_STANDARD: Standard = "WCAG2.1AA";

function resolveStandard(standard?: string): Standard {
  if (standard && standard in STANDARD_TAGS) return standard as Standard;
  return DEFAULT_STANDARD;
}

// ---------------------------------------------------------------------------
// validateInput — exactly one of url / html. TypeBox can't express XOR, so
// we enforce it here at the trust boundary before any browser action.

export function validateInput(params: AuditParams): ValidationOk | ErrorResult {
  const hasUrl = typeof params?.url === "string" && params.url.trim().length > 0;
  const hasHtml = typeof params?.html === "string" && params.html.length > 0;

  if (hasUrl === hasHtml) {
    // neither (both false) or both (both true) — reject either way.
    return {
      ok: false,
      error: "invalid_input",
      message: hasUrl
        ? "provide exactly one of `url` or `html`, not both"
        : "provide one of `url` or `html`",
    };
  }

  return hasUrl ? { ok: true, url: params.url } : { ok: true, html: params.html };
}

// ---------------------------------------------------------------------------
// buildAxeOptions — standard -> axe run options carrying the tag list under
// runOnly.values (axe-core's canonical shape).

export function buildAxeOptions(standard?: string): AxeRunOptions {
  const resolved = resolveStandard(standard);
  return {
    runOnly: { type: "tag", values: [...STANDARD_TAGS[resolved]] },
  };
}

// ---------------------------------------------------------------------------
// shapeResult — raw axe output -> structured success result.

export function shapeResult(
  axeRaw: any,
  meta: { standard: string; target: string },
): {
  ok: true;
  standard: string;
  target: string;
  summary: { violations: number; passes: number; incomplete: number };
  violations: Array<{
    id: string;
    impact: string;
    help: string;
    helpUrl: string;
    nodes: Array<{ target: string[]; html: string }>;
  }>;
} {
  const rawViolations: any[] = Array.isArray(axeRaw?.violations) ? axeRaw.violations : [];
  const passes: any[] = Array.isArray(axeRaw?.passes) ? axeRaw.passes : [];
  const incomplete: any[] = Array.isArray(axeRaw?.incomplete) ? axeRaw.incomplete : [];

  const violations = rawViolations.map((v) => ({
    id: typeof v?.id === "string" ? v.id : "",
    impact: typeof v?.impact === "string" ? v.impact : "",
    help: typeof v?.help === "string" ? v.help : "",
    helpUrl: typeof v?.helpUrl === "string" ? v.helpUrl : "",
    nodes: (Array.isArray(v?.nodes) ? v.nodes : []).map((n: any) => ({
      target: Array.isArray(n?.target) ? n.target : [],
      html: typeof n?.html === "string" ? n.html : "",
    })),
  }));

  return {
    ok: true,
    standard: meta.standard,
    target: meta.target,
    summary: {
      violations: violations.length,
      passes: passes.length,
      incomplete: incomplete.length,
    },
    violations,
  };
}

// ---------------------------------------------------------------------------
// toErrorResult — error -> structured fail-open result.

export function toErrorResult(
  err: unknown,
  opts: { code?: ErrorCode; standard?: string; target?: string } = {},
): ErrorResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    ok: false,
    error: opts.code ?? "audit_failed",
    message,
    ...(opts.standard !== undefined ? { standard: opts.standard } : {}),
    ...(opts.target !== undefined ? { target: opts.target } : {}),
  };
}

// ---------------------------------------------------------------------------
// createCdpRunner — the real runner. Attaches to a CDP-reachable Chromium
// (local OR remote/managed, e.g. AWS Bedrock AgentCore Browser) over CDP (no
// second browser), injects axe-core, runs it, closes the page. Dynamic
// import() inside the body keeps build/tests dependency-free.

export function createCdpRunner(config: RunnerConfig = {}): Runner {
  const cdpEndpoint = config.cdpEndpoint ?? "http://127.0.0.1:9222";
  const cdpHeaders = config.cdpHeaders;
  const connectTimeoutMs = config.connectTimeoutMs;

  return async function cdpRunner(ctx: RunnerContext): Promise<any> {
    // Imported lazily so module load never requires these packages.
    const { chromium } = (await import("playwright-core")) as any;
    const axeModule = (await import("axe-core")) as any;
    const axeSource: string = axeModule.source ?? axeModule.default?.source;

    let browser: any;
    let page: any;
    try {
      // endpoint + optional auth headers (the seam that lets this attach to a
      // remote/authenticated browser, not just a local one).
      const [endpoint, connectOptions] = buildConnectArgs(
        cdpEndpoint,
        cdpHeaders,
        connectTimeoutMs,
      );
      browser = await chromium.connectOverCDP(endpoint, connectOptions);
    } catch (err) {
      throw toErrorResult(err, {
        code: "browser_unavailable",
        standard: ctx.standard,
        target: ctx.target,
      });
    }

    try {
      const context = browser.contexts()[0] ?? (await browser.newContext());
      page = await context.newPage();

      try {
        if (ctx.url) {
          await page.goto(ctx.url, { waitUntil: "load" });
        } else {
          await page.setContent(ctx.html ?? "", { waitUntil: "load" });
        }
      } catch (err) {
        throw toErrorResult(err, {
          code: "navigation_failed",
          standard: ctx.standard,
          target: ctx.target,
        });
      }

      await page.evaluate(axeSource);
      const axeRaw = await page.evaluate(
        (opts: AxeRunOptions) => (window as any).axe.run(document, opts),
        ctx.axeOptions,
      );
      return axeRaw;
    } finally {
      try {
        if (page) await page.close();
      } catch {
        /* best effort */
      }
      try {
        await browser.close();
      } catch {
        /* best effort */
      }
    }
  };
}

// Default runner uses default config; execute() swaps in a fake in tests.
const defaultRunner: Runner = createCdpRunner();

// ---------------------------------------------------------------------------
// withTimeout — reject after ms so a hung page can't block the agent turn.

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!ms || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`audit timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// execute — the tool body. Validate -> options -> runner (seam) -> shape.
// ALWAYS resolves to { ok:... }; never throws (fails open).

export async function execute(
  params: AuditParams,
  runner: Runner = defaultRunner,
  config: RunnerConfig = {},
): Promise<any> {
  const standard = resolveStandard(params?.standard);
  const target = params?.url ?? (params?.html ? "<inline html>" : "");
  const timeoutMs = config.timeoutMs ?? 30000;

  // 1. Validate at the trust boundary BEFORE touching the runner seam.
  const v = validateInput(params);
  if (v.ok !== true) {
    return v;
  }

  // 2. Build axe options and run via the (injectable) runner under a timeout.
  try {
    const axeOptions = buildAxeOptions(params?.standard);
    const ctx: RunnerContext = {
      url: v.url,
      html: v.html,
      target,
      standard,
      axeOptions,
    };
    const axeRaw = await withTimeout(Promise.resolve(runner(ctx)), timeoutMs);
    return shapeResult(axeRaw, { standard, target });
  } catch (err: any) {
    // If the runner already produced a structured error result, surface it;
    // otherwise wrap as a generic audit_failed. Either way: never throw.
    if (err && typeof err === "object" && err.ok === false && typeof err.error === "string") {
      return err;
    }
    const isTimeout = err instanceof Error && /timed out/.test(err.message);
    return toErrorResult(err, {
      code: isTimeout ? "timeout" : "audit_failed",
      standard,
      target,
    });
  }
}
