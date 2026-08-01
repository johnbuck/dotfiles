---
name: pnk-tool-research
description: >-
  Research and recommend self-hosted, sysadmin, or homelab tooling — "what should
  I use to do X", "find me a tool for Y", "what are the options for Z", "compare
  A vs B", "is there something better than C". Load this BEFORE running any web
  search for candidate software. Enforces a curated-list-first method: enumerate
  candidates from awesome-selfhosted / awesome-sysadmin (and the cognee
  tool-catalog dataset), THEN web-research only the extracted names to establish
  2026 maintenance status. Open web search alone produces SEO filler and
  systematically misses established projects — that failure mode is the reason
  this skill exists.
---

# Researching and recommending tools

Web search is a **verification** tool here, not a **discovery** tool. Searching
"best homelab monitoring 2026" returns AI-generated affiliate listicles that
recycle the same six projects. Enumerate from curated indexes first.

## The method

### 1. Enumerate from the catalogue (never skip)

Fastest path — the catalogue is already indexed in cognee:

```
mcp__cognee__recall(query="<category> tools", datasets="tool-catalog")
```

The `tool-catalog` dataset holds **117 docs, one per category**, rendered from
1,338 awesome-selfhosted projects plus 268 awesome-sysadmin entries. Refreshed
weekly by `cognee-toolcatalog.timer` on wiley. Start with
`00-tool-catalog-index.md` if you need the category list.

If cognee is down, or you need a category it does not carry, go to source:

```bash
curl -sL -o /tmp/asf.md https://raw.githubusercontent.com/awesome-selfhosted/awesome-selfhosted/master/README.md
curl -sL -o /tmp/asa.md https://raw.githubusercontent.com/awesome-foss/awesome-sysadmin/master/README.md
grep -n '^#\{2,3\} ' /tmp/asa.md          # section index with line numbers
sed -n '482,535p' /tmp/asa.md             # extract the section verbatim
```

**awesome-selfhosted's "Monitoring & Status Pages" section is a stub that
redirects to awesome-sysadmin.** The ops depth — monitoring, metrics, log
management, containers, control panels, asset management, service discovery — is
in awesome-sysadmin. Check both; they do not overlap as much as the names suggest.

For programmatic work use the structured sibling
`awesome-selfhosted/awesome-selfhosted-data`: one YAML per project carrying
`stargazers_count`, `archived`, `current_release`, and a rolling 12-month
`commit_history`. That answers "alive in 2026?" without a single search.
`/home/wiley/Docker/cognee/toolcatalog_build.py` already parses it.

awesome-sysadmin has **no** structured-data sibling — parse its raw markdown.

### 2. Triage before you research

You will surface 40+ names. Do not research all of them. Bucket first:

- **Relics** — Nagios-era, still listed, effectively unused for new builds
  (Nagios, Cacti, Munin, Monit, Naemon, Thruk, Adagios, Icinga). Name them as
  relics in one line and move on. Do not silently omit them; the operator
  should see they were considered and rejected.
- **Wrong category** — solves an adjacent problem. One line, out.
- **Live candidates** — carry these into step 3.

### 3. Verify each live candidate

Only now use WebSearch/WebFetch, and only on the names you extracted. Establish
and **state** for each: latest version and release date, last commit activity,
license, multi-host support, whether it phones home, resource footprint, and the
honest downside. A candidate with no version number is not verified.

Treat AI-generated comparison sites (round numbers, affiliate framing, no
version specifics) as untrustworthy. Prefer GitHub releases, vendor docs, and
the project's own changelog.

### 4. Recommend

Give tiered options sized to the operator's appetite (light / medium / heavy)
rather than one answer, and say plainly when **no single tool covers the ask** —
that is usually true and pretending otherwise produces a bad recommendation.
Always list what you ruled out and why.

## Homelab constraints that disqualify tools

Check these before recommending anything for the Pinkleberry fleet:

- **No phone-home.** `PRIVACY.md` is default-deny on telemetry fleet-wide. Flag
  anything with telemetry on by default (Grafana's `[analytics]`, Netdata) and
  anything that pushes toward a SaaS tier or caps the local tier by node count.
- **No new rw Docker socket mounts** — SEC-02 is open, six consumers already.
  Use `tecnativa/docker-socket-proxy` with a read-only allowlist.
- **No `0.0.0.0` binds** (SEC-08). LAN-IP or localhost plus an auth proxy.
- **Auth** via Authentik OIDC, or behind Cloudflare Access. No new public ports.
- **Alerting** routes to existing ntfy, not a new sink.
- **Resource budget**: wiley runs GPU inference; thringle is 4-core/15 GB.
- Prefer an HTTP/JSON API so Daedalus can read it.

## Recording what you find

Durable, non-obvious findings go to cognee `homelab-shared` via `remember`.
Never write to the `homelab` or `tool-catalog` datasets — both are
doc-derived and rebuilt from source.

If the research leads to a decision, update
`backlog/P2-monitoring-stack-evaluation.md` or write a spec with `pnk-spec`.
