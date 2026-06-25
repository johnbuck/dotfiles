---
title: VPAT / Accessibility Conformance Report output
status: idea
area: [a11y-auditor skill]
created: 2026-06-24
tags: [backlog, accessibility, reporting, vpat]
---

# VPAT / Accessibility Conformance Report output

**One sentence:** Add an output mode that organizes findings by **WCAG success
criterion with a conformance status** — the shape of a VPAT / Accessibility
Conformance Report (ACR) — for a compliance audience, alongside the existing
developer-oriented report.

## Why

The current WAVE-style report is for **developers**: grouped by rule, with
selectors and fixes. A **compliance** audience expects a different artifact: the
VPAT / ACR, which walks each WCAG success criterion and assigns a conformance
level ("Supports", "Partially Supports", "Does Not Support", "Not Applicable")
with remarks. Same underlying data, very different document. If this plugin is
used to report to stakeholders, someone will eventually want the criterion-by-
criterion form, not a list of axe rule ids.

## What it might do

- Map axe results to **WCAG success criteria** (axe tags already carry
  `wcag###` / `wcag2a` etc.; each rule ties to one or more criteria).
- For each criterion in the target set, derive a status from the evidence:
  - failures present -> "Does Not Support" (or "Partially Supports"),
  - only passes -> "Supports",
  - axe can't test it -> "Not Evaluated / needs manual review" (do NOT claim
    "Supports" for criteria automation can't verify),
  - not present on the page -> "Not Applicable".
- Render the VPAT-style table: Criterion | Level | Status | Remarks.
- Output as Markdown and/or CSV (and possibly the standard ITI VPAT structure).

## Hard constraints

- **Honesty over completeness.** Automation can only *fail* or *flag* criteria;
  it cannot certify "Supports" for the many criteria it can't test. Those must be
  reported as not-evaluated / manual, never as conformant.
- **Not a legal certification.** A generated VPAT/ACR from automated checks is a
  draft/aid, not a signed conformance claim. State this on the artifact.

## Open questions

- Which VPAT edition/structure to target (e.g. the WCAG edition of the ITI VPAT).
- How to combine automated results with the manual-review-pass findings into one
  status per criterion (the two items feed each other).
