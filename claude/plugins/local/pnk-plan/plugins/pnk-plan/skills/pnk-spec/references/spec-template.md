# Backlog spec template

The structure for a `pnk-spec` backlog spec. One markdown file in the repo's `backlog/`.
Keep the headings; fill from the interview; delete guidance text. Use clear, human-readable
names throughout — never cryptic codes (`C1`, `M2`, `Step0`). Exclude these instructions from
the output.

The template's job is to force the decisions a downstream automated builder would otherwise
GUESS, and to stay reviewable by a human. Each section says how deep to go; scale depth to the
work (a one-line fix doesn't need the full technical section — say so and keep it short).

```markdown
---
title: <plain one-line title of the work>
status: draft             # draft (open blocking questions) | specced (ready to build) | in-progress | done
priority: P2              # match the repo's scheme if it has one
epic: <readable-epic-name># the epic this belongs to (defined in the roadmap)
area: [<area>, <area>]    # pick from the repo's existing areas (grep prior specs); don't invent one without reason
created: <YYYY-MM-DD>      # today's real date
tags: [backlog]
---

# <Title>

**One sentence:** what changes and why, in plain language.

## Why this exists
The problem, and who has it. One or two short paragraphs. (Skip "What we're building" below if
this plus the one-sentence summary already make it obvious — don't restate four times.)

## What we're building
A short, concrete description of the feature/work from the user's point of view.

## Behavior
- **Actors / systems:** who or what triggers this, and which external systems/services it touches.
- **Preconditions:** the state, data, or services that must already exist for this to run.
- **Main flow:** the primary path, step by step. Plain language — "should", not "must";
  "interact", not "click".
- **Alternate & error flows:** what happens on bad input, a dependency being down, or a step
  failing. At least one error flow is required unless the work genuinely cannot fail (say why).
- **Postconditions:** the observable end state after success.

## Acceptance criteria
A list of testable conditions. These ARE pnk-baton's contract — the planner turns each into a
test. Rules:
- Each criterion has a short readable **handle** (kebab-case, describes the criterion, e.g.
  `rejects-expired-token`) that tests and the as-built record cite. Handles stay stable if you
  reorder or insert criteria. Never a cryptic code (`AC1`, `C2`).
- One assertion per criterion. Split "X and Y" into two.
- Each criterion names HOW it is verified: a test, a command + expected output/exit code, an
  HTTP status, a file that should exist, or a log line. If you can't name the check, it isn't an
  acceptance criterion — move it to Behavior or cut it.
- At least one criterion covers a failure/error path. Happy-path-only is rejected.
- If the work has performance / resource (CPU/RAM/VRAM) / latency / uptime limits, state them
  here as criteria with the limit and how it's measured — not as prose elsewhere.

- **<readable-handle>** — <condition>; verified by: <test name / command + expected result>
- **<readable-handle>** — <condition>; verified by: <…>

## Technical approach
The chosen design and the exact surface it touches:
- **Deploy target:** host, deploy path, compose project, ports. State it even if "same as
  existing service X". (Omit for non-deployed/pure-logic work.)
- **Files:** each path, marked (new) or (modified), one line on what changes in each.
- **Tech choices:** any library/framework/tool gets a one-line rationale (why this over the
  obvious alternative).
- **Schemas / APIs:** show a concrete example record / request / response in JSON, not field
  names alone.
- For non-trivial technical work, follow `references/technical-depth.md` (architecture
  request-flow trace, data/store shapes, error schemas, annotated file tree, env-var table,
  risk table). Scale to the work — don't manufacture depth a small change doesn't need.

## Constraints (must-not)
Hard red lines for this work — things the build must not do even to make a test pass. Inherit
the repo's CLAUDE.md forbidden-actions and restate any this work could plausibly trip.
- <e.g. do not remove or weaken existing service dependencies (`depends_on`)>
- <e.g. do not modify DNS / Pi-hole / firewall config>
- <e.g. no destructive DB operations; additive migrations only>

## Data and safety
Does this touch persisted data? If so: additive/reversible, no silent destruction, validate on
staging first, state the blast radius of any destructive step.

**Security (address each, or write "n/a — <why>"):**
- Authentication AND authorization model (who can do what).
- Input validation / sanitization at trust boundaries.
- Encryption in transit and at rest where applicable.
- Secrets: which ones, stored where (Infisical), injected how — never in the repo.
- If this collects/processes/shares personal or external data, add a short table:
  Data type | Collected | Processed | Shared externally.

## Scope
### In scope (now)
- <deliverable>
### Out of scope (deliberately deferred)
- <deliberately-deferred item> — stated, not silently omitted.

## Testing
What proves it works: unit / integration / end-to-end, the frameworks, and lint/format/type
gates. Tie each back to the acceptance criteria above.

## Dependencies
What this work depends on, and what depends on it.

## Observability & done-in-production
How we'll know it's working AFTER it ships: the runtime signal (monitor, log line, metric,
healthcheck) and where it's observed. If this adds or changes a service, state the Uptime Kuma
monitor / ntfy alert it should have. If there's genuinely nothing to observe at runtime, say so.

## Open questions
Anything undecided; mark human decisions `[@humanUser …]`. A question whose answer changes the
design, acceptance criteria, or scope is BLOCKING — keep `status: draft` until it's resolved.
Only non-blocking nits may remain at `status: specced`. pnk-baton should not build a spec with
open blocking questions.
```
