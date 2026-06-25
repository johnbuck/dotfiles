---
title: Support WCAG 2.2
status: idea
area: [a11y-auditor skill, a11y_audit tool]
created: 2026-06-24
tags: [backlog, accessibility, wcag22]
---

# Support WCAG 2.2

**One sentence:** Add WCAG 2.2 as a selectable standard (and consider making it
the default), since 2.2 is now the current working version — we currently target
up to 2.1.

## Why

WCAG 2.2 is the current recommendation and the de-facto working standard. We
default to / cap at WCAG 2.1 AA. 2.2 adds nine success criteria over 2.1,
including several that matter for typical apps:

- 2.4.11 / 2.4.12 Focus Not Obscured (Minimum / Enhanced)
- 2.4.13 Focus Appearance
- 2.5.7 Dragging Movements
- 2.5.8 Target Size (Minimum) — interactive targets ≥ 24×24px
- 3.2.6 Consistent Help
- 3.3.7 Redundant Entry
- 3.3.8 / 3.3.9 Accessible Authentication (Minimum / Enhanced)

## What it might do

- Add `WCAG2.2AA` (and `WCAG2.2A` / `WCAG2.2AAA`) to the `standard` options.
- Map to the axe tag set: axe-core exposes `wcag22aa` / `wcag22a` tags for the
  criteria it can test — extend the standard -> `values` table accordingly.
- Decide the **default**: keep 2.1 AA, or move the default to 2.2 AA.
- Note which 2.2 criteria axe can/can't automate (e.g. target size is partly
  automatable; focus-appearance and accessible-auth are largely manual) — the
  manual ones belong to the manual-review-pass item.

## Considerations

- **axe coverage:** confirm which 2.2 criteria the pinned axe-core version
  actually checks (varies by axe release — ties to the pin-maintenance note).
- **Default change is user-visible:** moving the default standard changes results
  for existing callers; flag it.
- Keep the standard -> tag table in the skill and the tool (`buildAxeOptions`)
  in sync.

## Scope

### In scope (eventually)
- New `WCAG2.2*` standard values + tag mapping in both the skill and the tool;
  decision on the default; note manual-only 2.2 criteria.

### Out of scope
- Implementing the manual-only 2.2 checks (covered by the manual-review-pass item).
