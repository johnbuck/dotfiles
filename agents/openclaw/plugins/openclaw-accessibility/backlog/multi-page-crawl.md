---
title: Multi-page / site crawl auditing
status: idea
area: [a11y-auditor skill, a11y_audit tool]
created: 2026-06-24
tags: [backlog, accessibility, crawl]
---

# Multi-page / site crawl auditing

**One sentence:** Audit more than one URL in a run — crawl or sample a set of
pages and produce a combined report — instead of the current single-page audit.

## Why

Today both the skill and the tool audit one URL. Real audits cover a site:
templates repeat (a broken nav or footer is broken on every page), and the worst
issues often live on pages other than the one you happened to test. A single-page
result over-claims ("the site is fine") from a sample of one.

## What it might do

- **Page set sources:** an explicit list of URLs, a sitemap.xml, or a shallow
  same-origin crawl from a start URL (bounded by depth + max-pages).
- **Per-page audit** reusing the existing axe run, then **aggregate**:
  - de-duplicate issues that repeat across pages (same rule + same element
    pattern) and report them once with "affects N pages",
  - per-page breakdown + a site-level rollup (totals, worst pages),
  - keep the WAVE-style grouped format per page and in the rollup.
- **Output:** the existing inline / Markdown / CSV options, with a page column.

## Considerations

- **Bounding:** max pages, depth, same-origin only, respect robots.txt, polite
  rate — auditing a whole site is expensive (a browser session + axe per page).
- **Auth / state:** crawling authenticated areas and interactive states is a
  separate hard problem (see the manual-review-pass item) — likely out of scope
  for a first cut.
- **Cost/latency:** N pages = N browser navigations + N axe runs; cap and report
  what was and wasn't covered (no silent truncation).
- **Dedup heuristic:** how to decide two findings are "the same" across pages
  (rule id + normalized selector?) needs design.

## Scope

### In scope (eventually)
- Explicit URL list and sitemap input; bounded same-origin crawl; aggregated
  report with cross-page dedup.

### Out of scope (for a first cut)
- Authenticated crawls, interactive-state coverage, JS-heavy infinite scroll.
