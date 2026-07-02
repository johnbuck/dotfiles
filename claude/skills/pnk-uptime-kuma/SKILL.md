---
name: pnk-uptime-kuma
description: >-
  Interact with an Uptime Kuma monitoring server through its HTTP MCP bridge —
  list/check monitors, and create/update/pause monitors and notifications. Load
  this BEFORE using any mcp__uptime-kuma__* tool, and ESPECIALLY when a Kuma call
  returns "Not authenticated with Uptime Kuma" (almost always a transient
  cold-start race, NOT a credential problem — retry once). Covers the native
  streamable-http bridge architecture, creating monitors (incl. the push-token
  limitation), and the updateMonitor / notification gotchas.
---

# Uptime Kuma via the MCP bridge

Uptime Kuma is driven through an **HTTP MCP bridge** (`@davidfuchs/mcp-uptime-kuma` in its native
`--transport streamable-http` mode), not a direct API. Tools are `mcp__uptime-kuma__*`
(`getMonitorSummary`, `listMonitors`, `listNotifications`, `createMonitor`, `updateMonitor`,
`pauseMonitor`/`resumeMonitor`, `deleteMonitor`, `addNotification`, `createMaintenance`, …). Start a
status question with `getMonitorSummary`; use `listMonitors` for config; `listNotifications` for channels.

> This file is **portable procedure only.** Host, container name, published port, compose path, and
> notification/group ids are environment-specific — get them from your infra docs, `docker ps`, or
> `listMonitors`/`listNotifications`, not from here. Never hardcode them into the skill.

## The #1 gotcha — "Not authenticated" is a transient cold-start race, not bad credentials

If a tool returns `MCP error -32603: Not authenticated with Uptime Kuma`, **do not assume the token is
wrong.** The server holds ONE persistent socket.io connection to the Kuma backend, opened at startup.
That connect is async, so for a second or two right after the container (re)starts — or after the MCP
client re-establishes its session following a blip — a tool call can land *before* the upstream auth
completes → "Not authenticated". The logs show `Successfully authenticated` a moment later.

**The fix is just: retry once.** The connection warms within a second or two and the next call succeeds.
Only dig deeper if it keeps failing across many seconds — a real credential/backend problem shows a
`401` login failure in the logs, not `Successfully authenticated`.

## Native transport, not supergateway (why the bridge is a single process)

Prefer the package's native `mcp-uptime-kuma -t streamable-http` — one long-lived process holding one
shared upstream connection — over wrapping stdio in `supergateway`. The supergateway wrapper forks a
fresh `mcp-uptime-kuma` child per MCP `initialize` and doesn't reliably reap them; each child holds a
Kuma socket, so under client churn they pile up until the container OOMs. `--stateful` mitigates but does
not cure it. If you find a Kuma MCP still on supergateway, migrating to native transport is the root fix:
drop supergateway, `command: mcp-uptime-kuma -t streamable-http`, set the port via `PORT`, and point the
healthcheck at the native `/health` endpoint.

## Creating monitors
`createMonitor` types: `http`, `port` (TCP), `ping`, `dns`, `push`, `keyword`.
- **Notifications:** attach via `notificationIDList`, e.g. `{"1": true}`. Get the id from
  `listNotifications` (use the `isDefault` channel unless told otherwise).
- **Grouping:** set `parent` to a group monitor's id — get current group ids from `listMonitors`; they
  drift, so never hardcode them.
- TCP/port checks only reach hosts Kuma itself can route to; a container on a private docker network is
  **not** reachable from Kuma — prefer a **push** monitor fed by a host-side probe in that case.

## `updateMonitor` gotchas
- It MERGES your fields with the existing config (call `getMonitor` first if unsure).
- **`Retry interval cannot be less than 1 seconds`**: some monitors (notably `push`) store
  `retryInterval: 0`; any update re-validates the whole config and fails. **Pass `retryInterval: 60`**
  (or any ≥1) alongside your change.
- Pause/unpause: `updateMonitor active:false` (with `retryInterval:60`) or `pauseMonitor`/`resumeMonitor`.

## PUSH monitors — the MCP does NOT expose the push token (and may not even SET one)
`createMonitor type:push` makes the monitor, but **`getMonitor` returns `pushToken: null` and
`updateMonitor` has no `pushToken` field** — so you cannot build the push URL from the MCP. **Worse: an
MCP-created push monitor can have a genuinely NULL `push_token` in the DB** — no URL to push to, so the
monitor stays permanently DOWN with "no heartbeat." Confirm in the Kuma DB:
`select id, case when push_token is null then 'NULL' else 'len='||length(push_token) end from monitor where type='push';`
(single quotes for SQLite string literals — double quotes are identifiers and silently misbehave). If
NULL, set a 32-char token (`update monitor set push_token='<openssl rand -hex 16>' where id=<id>;`).
Kuma's `/api/push/:token` endpoint looks the token up in the DB directly, so a fresh push lands without a
Kuma restart; the monitor's `interval` must be **≥ the push cadence** or it flips DOWN between pushes. To
wire it: get the push URL from the Kuma UI (or the DB token), have a host timer hit
`<url>?status=up&msg=OK` on a healthy probe, and **pause the push monitor until the URL is wired** so it
doesn't false-alert from a missing heartbeat.

## Secrets
The bridge authenticates with a Kuma base URL + JWT from its environment. Never print those values; see
[[pnk-secret-hygiene]].
