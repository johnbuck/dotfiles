# Playwright e2e harness — agent-hub container

Reusable patterns for running Playwright end-to-end tests from inside an
openclaw container. Read this when the validator step requires a real
browser run.

## Environment assumptions

- `PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers` (set in the image).
- `NODE_ENV=production` is set globally — `npm ci`/`npm install` skip
  `devDependencies` unless you pass `--include=dev`.
- The container has DNS for `gateway` (the agent-hub Caddy proxy) and for
  other containers on the `agent-hub-sandbox` Docker network. It does
  **not** resolve `*.local` (no mDNS) or `*.lan` (Docker's internal
  resolver bypasses Pi-hole).
- A git worktree allocated by pipeline-guard does not contain
  `node_modules` — the parent checkout's modules are not shared.

## One-time worktree setup

```bash
cd "$WORKTREE/frontend"
npm ci --include=dev --no-audit --no-fund --no-progress
```

If `npm ci` errors with "lockfile out of sync," fall back to
`npm install --include=dev` and report the lockfile drift as a finding.

## Picking BASE_URL

| Target                              | URL                                       |
|-------------------------------------|-------------------------------------------|
| deployed frontend (deployed, the compute host) | `http://gateway:8080/app/`              |
| deployed API (deployed)       | `http://gateway:8080/app-api/`          |
| Local `vite preview` (fallback)     | `http://localhost:<port>/` (loopback only)|

For any other service, ask the architect for the gateway prefix or check
`docs/PLAN.md` / the per-service `README.md` in this repo — never
hard-code `*.local` or `*.lan` host names. The Caddyfile itself is not
mounted into this container; the gateway routes are documented in
`docs/PLAN.md`.

## Running the test suite

```bash
cd "$WORKTREE/frontend"
BASE_URL=http://gateway:8080/app/ \
  npx playwright test --reporter=line
```

Outputs:

- Pass/fail summary on stdout.
- Screenshots and traces under `test-results/`.
- HTML report under `playwright-report/` (only if the project's config
  enables the html reporter).

## Reusable viewport-sweep spec

Drop the following into `e2e/viewports.spec.ts` (adjust the page locators
to match what the spec under test asserts):

```ts
import { test, expect } from "@playwright/test";

const sizes = [
  { w: 375, h: 812, label: "phone" },
  { w: 768, h: 1024, label: "tablet" },
  { w: 1920, h: 1080, label: "desktop" },
];

for (const s of sizes) {
  test(`renders at ${s.label} ${s.w}x${s.h}`, async ({ page }) => {
    await page.setViewportSize({ width: s.w, height: s.h });
    await page.goto("/", { waitUntil: "networkidle" });

    const root = page.locator("#root, body > div").first();
    await expect(root).toBeVisible();

    const box = await root.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);

    // Spec-specific invariants go here. Examples:
    //   - canvas dimensions match viewport
    //   - hit-tested element responds to click
    //   - no horizontal scroll: await expect(page.evaluate(...))

    await page.screenshot({
      path: `test-results/screenshot-${s.label}.png`,
      fullPage: false,
    });
  });
}

test("survives a runtime resize", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(250); // let ResizeObserver fire
  const root = page.locator("#root, body > div").first();
  const box = await root.boundingBox();
  expect((box?.width ?? 0)).toBeLessThanOrEqual(375);
});
```

The runtime-resize test is the one that catches the canvas/`ResizeObserver`
regressions that jsdom unit tests cannot see. Don't skip it.

## Common failure modes

- **`Error: Cannot find package '@playwright/test'`** — devDependencies
  weren't installed. Re-run `npm ci --include=dev`.
- **`Error: net::ERR_NAME_NOT_RESOLVED at http://compute-host:5173`** —
  `BASE_URL` was not overridden. Use `http://gateway:8080/app/`.
- **`Error: Project(s) "chromium" not found. Available projects: ""`** —
  the worktree's `playwright.config.ts` is missing on this branch.
  Either add the config back or run with no `--project` flag and an
  inline config (see the harness above).
- **`browserType.launch: Executable doesn't exist at …`** — a Playwright
  version inside the worktree's `node_modules` differs from the bundled
  browser. Run `npx playwright install chromium` *inside the worktree*
  to materialize the matching browser into `/opt/playwright-browsers`.
- **`page.goto: net::ERR_CONNECTION_REFUSED`** — the deployed artifact is
  not actually serving. Check `curl -sS http://gateway:8080/app/` from
  within the container before re-running the suite.

## When you must build first

If the spec changes the deployed artifact, the validator must build and
deploy before the e2e run, otherwise the test exercises the *previous*
build:

```bash
cd "$WORKTREE/frontend"
npm run build
cd ..
./deploy.sh frontend
# wait a few seconds for graph-deploy to swap the bundle
sleep 3
curl -sS -o /dev/null -w "%{http_code}\n" http://gateway:8080/app/
# expect 200 — then run Playwright
```

Skipping the deploy step is the most common reason a "validation pass"
later turns out to have tested stale code.
