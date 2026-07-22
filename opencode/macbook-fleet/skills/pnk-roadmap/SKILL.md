---
name: pnk-roadmap
description: Use this skill to create or maintain a project's roadmap, the plain, human-readable plan of what is being built, in what order, grouped by epic. Triggers when the operator wants to "create a roadmap", "update the roadmap", "what's next", "plan the milestones", "organize the work into epics", or asks how the pieces fit together. The roadmap is also the epic index (each epic is a roadmap section). Writes ROADMAP.md at the project root. For writing a single spec, see pnk-spec.
---

# pnk-roadmap: create and maintain the living roadmap

The roadmap is the plain answer to "what are we building, in what order, and why." It is a **living
document**: this skill both **creates** it when none exists and **updates** it as work lands. Keep
it current, because it is where the operator (and a later Claude Code session) looks to see whether
a piece of work is on the plan.

**The roadmap is also the epic index.** There are no separate epic files. Each epic is a section of
the roadmap with a short charter and the list of specs under it.

## You are steering a nontechnical operator

Do not interview the operator for structure. **Organize the work into simple, plainly named epics
yourself, then show them the result** and let them adjust. Confirm non-trivial changes with the
`question` tool, in plain language. The operator says what they want built; you group it sensibly.

## The two rules that matter most

1. **Clarity over ceremony.** Plain words, short sentences, tables. A reader new to the project
   should understand the shape of the work on one read.
2. **No cryptic identifiers.** Epics, milestones, and items are named by what they ARE
   (`live-roadmap-maintenance`), never coded (`M2`, `C1`, `Step0`). This is not negotiable.

(No emoji before headings. Leave these instructions out of the roadmap itself.)

## Locate or create

The roadmap lives as `ROADMAP.md` at the project root. Use that location. If a roadmap already
exists, **read it and update in place**; do not rewrite it from scratch.

## Create (no roadmap yet)

Do the grouping yourself rather than quizzing the operator:
- Take the work you already know about (from the operator's description and any specs in `backlog/`)
  and sort it into a few simple epics, each a theme of work with a plainly named handle.
- For each epic, write a one-line charter (what it is for) and a line on what it deliberately does
  not cover.
- Put the epics in a rough order: what comes first, and what depends on what.
- Mark what is already done, in progress, or not started.

Then write `ROADMAP.md` from the template. Read the template by the **absolute path opencode gives
you when it loads this skill** (opencode injects this skill's own directory); do not use a bare
relative path like `references/roadmap-template.md`, which opencode resolves against the project
you are working in, not this skill. Concretely, read
`<this skill's directory>/references/roadmap-template.md`.

Show the operator the resulting epics and order in plain language, and use the `question` tool to
confirm or adjust before you consider it settled.

## Maintain (roadmap exists)

Run any time to keep it true:
- Mark items done, in progress, or not started as work lands.
- Add new specs under the right epic (pnk-spec places a spec under its epic here).
- Re-order when priorities change.
- Add or retire epics as the project's shape changes.
Confirm non-trivial changes with the `question` tool. Keep the prose tight; prune stale detail.

## Tie specs to epics

Every backlog spec carries an `epic: <readable-name>` in its frontmatter. The matching epic section
in the roadmap lists that spec. When pnk-spec adds a spec, place it under its epic here and set the
spec's `epic` field to match, so the roadmap always answers "does this work map to a plan item?"

## After updating

If a freshly placed spec is ready to turn into code, offer next steps in plain language: hand the
spec to the operator, or to a later Claude Code session, to build; or, for a brand-new project, run
**pnk-scaffold** to set up the code skeleton. There is no automated build handoff on this machine.
