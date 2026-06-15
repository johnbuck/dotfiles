---
name: pnk-uptime-kuma
description: >-
  Interact with the homelab Uptime Kuma monitoring server through its MCP bridge
  — list/check monitors, and create/update/pause monitors and notifications. Load
  this BEFORE using any mcp__uptime-kuma__* tool, and ESPECIALLY when a Kuma call
  returns "Not authenticated with Uptime Kuma" (that is almost always a fixable
  bridge session-race, NOT a credential problem). Covers the bridge architecture,
  the --stateful fix + restart runbook, creating monitors (incl. the push-token
  limitation), and the updateMonitor / notification gotchas.
---

# Uptime Kuma (homelab) — interacting via the MCP bridge

The homelab Uptime Kuma is driven through an **HTTP MCP bridge**, not a direct API. Tools are
`mcp__uptime-kuma__*` (`getMonitorSummary`, `listMonitors`, `listNotifications`, `createMonitor`,
`updateMonitor`, `pauseMonitor`/`resumeMonitor`, `deleteMonitor`, `addNotification`, `createMaintenance`,
…). Start a status question with `getMonitorSummary`; use `listMonitors` for config; `listNotifications`
for channels.

## The #1 gotcha — "Not authenticated" is a SESSION RACE, not bad credentials

If a tool returns `MCP error -32603: Not authenticated with Uptime Kuma`, **do not assume the token is
wrong.** The bridge is `supergateway` wrapping the `mcp-uptime-kuma` child; the child connects to the
Kuma backend **asynchronously on each MCP `initialize`**. If supergateway runs **stateless** (the
default), every tool call arrives on a fresh session → supergateway auto-initializes → the child starts
a new async Kuma connection → the tool call is served **before auth completes** → "Not authenticated".
The logs then show the auth landing a moment *too late*.

**Confirm the diagnosis:**
```bash
ssh wiley 'docker logs --tail 25 uptime-kuma-mcp 2>&1' | grep -iE "auto-initialize|Not authenticated|Successfully authenticated"
```
If you see `Non-initialize message detected, sending auto-initialize` followed by `Not authenticated`
and THEN `Successfully authenticated` — it's the race. (Credentials are fine: the child *does* auth.)

### The fix — run supergateway `--stateful`
Add `--stateful` to the bridge command so supergateway keeps ONE persistent session (the child stays
authenticated). This also mitigates the 2026-05-05 OOM (runaway per-request children).

- Compose: `/home/wiley/Docker/mcp-servers/docker-compose.yml`, service `uptime-kuma-mcp`
  (`build: ./uptime-kuma`; the supergateway CMD is in the image). Add a `command:` override:
  ```yaml
      command: ["supergateway", "--stdio", "mcp-uptime-kuma", "--port", "8403",
                "--outputTransport", "streamableHttp", "--healthEndpoint", "/health", "--stateful"]
  ```
- Recreate just that service, then wait for re-auth:
  ```bash
  ssh wiley 'cd /home/wiley/Docker/mcp-servers && docker compose up -d uptime-kuma-mcp'
  ssh wiley 'for i in $(seq 1 12); do docker logs --since 30s uptime-kuma-mcp 2>&1 | grep -q "Successfully authenticated" && break; sleep 2; done'
  ```
- The Claude harness drops + re-establishes its MCP session automatically (you'll see a
  "still connecting / disconnected" system reminder). Then **retry the tool call.**

### Even with `--stateful`, retry on "Not authenticated"
After a reconnect/blip the *first* call on a cold session can still race. **Just call again** — a retry
on the now-warm persistent session succeeds. Treat a single "Not authenticated" as transient; retry once
before doing anything heavier.

## Bridge facts (for diagnosis / restart)
- Container `uptime-kuma-mcp` on **wiley** (`REDACTED`), HTTP MCP at `:8403/mcp`. `serverInfo`:
  `mcp-uptime-kuma` v0.7.0; supergateway v3.4.x.
- Auth via env `UPTIME_KUMA_URL` + `UPTIME_KUMA_JWT_TOKEN` (from the compose `.env`). The JWT is a
  secret — never print env values; see [[pnk-secret-hygiene]]. A *credential* problem looks different:
  the logs would show a failed/`401` login, not "Successfully authenticated".
- `mem_limit: 1g` + a healthcheck capping `mcp-uptime-kuma` child procs ≤ 30 + a cron watchdog restart
  on unhealthy (legacy leak guard — `--stateful` removes the leak's root cause).

## Creating monitors
`createMonitor` types: `http`, `port` (TCP), `ping`, `dns`, `push`, `keyword`.
- **Notifications:** attach via `notificationIDList`, e.g. `{"1": true}`. The homelab default channel is
  `ntfy (pinkleberry-alerts)` = **id 1** (`listNotifications` to confirm). It's `isDefault`.
- **Grouping:** set `parent` to a group monitor id. Current groups: **Internal=10, Network=14, AI=32,
  Backups=33, VPN Proxies=47** (re-check with `listMonitors` — ids drift).
- TCP/port checks only reach hosts Kuma itself can route to; a container on a private docker network
  (e.g. `adb-bridge:1081` on `pinkleberry_bridge`) is **not** reachable from Kuma — prefer a **push**
  monitor fed by a host-side probe in that case.

## `updateMonitor` gotchas
- It MERGES your fields with the existing config (call `getMonitor` first if unsure).
- **`Retry interval cannot be less than 1 seconds`**: some monitors (notably `push`) store
  `retryInterval: 0`; any update re-validates the whole config and fails. **Pass `retryInterval: 60`**
  (or any ≥1) alongside your change.
- Pause/unpause: `updateMonitor active:false` (with `retryInterval:60`) or `pauseMonitor`/`resumeMonitor`.

## PUSH monitors — the MCP does NOT expose the push token (and may not even SET one)
`createMonitor type:push` makes the monitor, but **`getMonitor` returns `pushToken: null` and
`updateMonitor` has no `pushToken` field** — so you cannot build the push URL from the MCP. **Worse: an
MCP-created push monitor can have a genuinely NULL `push_token` in the DB** (not just hidden) — so there's
no URL to push to and the monitor stays permanently DOWN with "no heartbeat." Confirm with the DB:
`select id, case when push_token is null then 'NULL' else 'len='||length(push_token) end from monitor where type='push';`
(use **single quotes** for SQLite string literals — double quotes are identifiers and silently misbehave).
If NULL, **set a 32-char token** (`update monitor set push_token='<openssl rand -hex 16>' where id=<id>;`).
Kuma's `/api/push/:token` endpoint looks the token up **in the DB directly**, so a fresh push lands without
a Kuma restart; the monitor's `interval` must be **≥ the push cadence** or it flips DOWN between pushes.
To wire it:
1. Get the push URL from the **Kuma UI** (the monitor's page shows `<KUMA_BASE>/api/push/<token>`), or
   from the Kuma backend DB (the token is low-sensitivity but don't splash it to stdout — relay via stdin).
2. A host timer hits `<url>?status=up&msg=OK` on a healthy probe; when the pings stop (down/leak), Kuma
   marks the monitor DOWN and alerts. (See the SearXNG mobile-egress monitor wiring in homelab-core
   `tools/searxng-proxy/systemd/searxng-egress-asn-check.service`.)
3. Until the URL is wired, **pause the push monitor** so it doesn't false-alert from a missing heartbeat.

## Spec
Architecture + the `--stateful` decision are captured in the homelab repo:
`backlog/P1-uptime-kuma-mcp-bridge.md`.
