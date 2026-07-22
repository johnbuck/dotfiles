# Backlog spec template

The structure for a `pnk-spec` backlog spec. One markdown file in the project's `backlog/`.
Keep the headings, fill them from the interview, and delete the guidance text. Use clear,
human-readable names throughout, never cryptic codes (`C1`, `M2`, `Step0`). Leave these
instructions out of the output.

The template's job is to force the decisions a later builder would otherwise guess, and to stay
reviewable by a person. Each section says how deep to go; scale the depth to the work (a one-line
fix does not need the full technical section, so say so and keep it short).

Because the operator here is nontechnical, keep the "Assumptions the agent made, please check
these" section honest and in plain words: every technical choice you made without confirming it
belongs there, not buried in confident prose.

```markdown
---
title: <plain one-line title of the work>
status: draft             # draft (open blocking questions) | specced (ready to build) | in-progress | done
priority: P2              # match the project's scheme if it has one
epic: <readable-epic-name># the epic this belongs to (defined in the roadmap)
area: [<area>, <area>]    # pick from the project's existing areas; don't invent one without reason
created: <YYYY-MM-DD>      # today's real date
tags: [backlog]
---

# <Title>

**One sentence:** what changes and why, in plain language.

## Why this exists
The problem, and who has it. One or two short paragraphs. (Skip "What we're building" below if
this plus the one-sentence summary already make it obvious. Do not restate the same thing four
times.)

## What we're building
A short, concrete description of the work from the user's point of view.

## Assumptions the agent made, please check these
The technical choices the agent made for you, in plain words, so you can catch a wrong one before
it gets built. Every choice taken from the house preferences or from the agent's own judgment,
rather than something you stated, goes here. Keep each line plain and specific.
- <e.g. "I assumed this is a normal web app, so the code is Python on the server and a React web
  page in the browser. Tell me if you pictured a phone app instead.">
- <e.g. "I assumed your saved items go in a simple file-based database (SQLite). That is fine for
  hundreds or a few thousand items; tell me if you expect a lot more.">
- <e.g. "I assumed only you use this, so there is no login. Tell me if other people need accounts.">

## Current behavior (as-is)
REQUIRED whenever the work changes something that already exists (omit only for a brand-new,
from-scratch project, and say so). An inventory of what the touched code path does today, written
by READING the code at spec time, never from memory. List every behavior-shaping element on the
path: each filter, limit, cap, guard, gate, fallback, branch, ordering rule, and cache, with its
file:line. This is the list the change map dispositions; anything doing something on this path that
is not listed here is a spec defect.
- <element>: <what it does> (`path/to/file.py:123`)
- <element>: <what it does> (`path/to/file.py:145`)

## Change map
Every as-is element gets an explicit disposition. **Anything not listed as CHANGE or REMOVE is
KEEP, and the build should not alter it.** REMOVE lines are the only authorized deletions; a build
that removes a guard, filter, or behavior with no REMOVE line here has drifted from the spec.

| As-is element | Disposition | Detail |
|---|---|---|
| <element> | KEEP | unchanged |
| <element> | CHANGE | <exact new behavior> |
| <element> | REMOVE | <why it is safe to remove> |

## Project rules check (should not violate)
Check the spec against the project's own written rules: its README, any contributing or conventions
doc, and the patterns the existing code already follows. Quote each rule that governs the touched
area with its file path (verified by reading the file, not paraphrased from memory), and state how
the change complies. Each testable rule becomes a regression test.
Rules for this section:
- Only rules that actually EXIST in the project's docs or code belong here. Never invent a rule
  locally; a spec-invented "rule" has no authority and can lock in a bug.
- If no written rule governs this area, write "none, no project rule governs this area" and move
  on. If you think a rule SHOULD exist, that is a change to the project's README for the operator to
  make on purpose, not something this spec declares.
- Non-written hard lines (a performance bound, "don't touch X") belong in Constraints below, not
  here.
- **<rule-handle>**: "<verbatim quote>" (`README.md § <section>`); complies by: <how>;
  testable: <condition a test or command can check>

## Behavior
- **Actors / systems:** who or what triggers this, and which outside systems or services it touches.
- **Preconditions:** the state, data, or services that should already exist for this to run.
- **Main flow:** the primary path, step by step. Plain language: "should", not "must"; "interact",
  not "click".
- **Alternate & error flows:** what happens on bad input, a dependency being down, or a step
  failing. At least one error flow is required unless the work genuinely cannot fail (say why).
- **Postconditions:** the observable end state after success.

## Acceptance criteria
A list of testable conditions. These are the contract the build works to; each one becomes a test.
Rules:
- Each criterion has a short readable **handle** (kebab-case, describes the criterion, e.g.
  `rejects-expired-token`) that tests cite. Handles stay stable if you reorder or insert criteria.
  Never a cryptic code (`AC1`, `C2`).
- One assertion per criterion. Split "X and Y" into two.
- Each criterion names HOW it is verified: a test, a command plus expected output or exit code, an
  HTTP status, a file that should exist, or a log line. If you cannot name the check, it is not an
  acceptance criterion; move it to Behavior or cut it.
- At least one criterion covers a failure or error path. Happy-path-only is rejected.
- If the work has performance, memory, latency, or uptime limits, state them here as criteria with
  the limit and how it is measured, not as prose elsewhere.

- **<readable-handle>**: <condition>; verified by: <test name / command + expected result>
- **<readable-handle>**: <condition>; verified by: <...>

## Technical approach
The chosen design and the exact surface it touches. **Write this at plan-mode specificity:** an
implementation plan a builder can execute without inventing anything, grounded in the actual code
(read it first). Concise enough to scan quickly, detailed enough to execute effectively. It carries
the RECOMMENDED approach only; an alternative considered gets at most a one-line "chosen over X
because Y".
- **Exact locations:** file:line and function names for every touch point, from reading the code.
  For a pattern repeated across many files, describe the pattern once with a few representative
  paths.
- **The actual code:** for any non-trivial change, include the code to write (the exact query, the
  function body, the config block) as a build-ready appendix if long. A spec that says "add a
  filter" drifts; a spec that shows the filter does not.
- **Reuse ledger:** the existing functions, utilities, and patterns this work calls instead of
  reinventing, each with its file path. New code appears only where this ledger has no suitable
  entry.
- **Implementation order:** the ordered steps: which files are created or modified in which
  sequence, and where migrations, flags, or deploys fall.
- **Prototype as contract:** when the work comes from a dialed-in prototype, embed the prototype's
  real code and interaction mechanics verbatim; the builder ports them faithfully rather than
  re-deriving from a description.
- **Risks & mitigations:** what could go wrong in the build or at runtime, and the mitigation for
  each, scaled to the work.
- **Deploy target:** where it runs (folder, compose project, ports). State it even if "same as
  existing service X". (Omit for pure-logic work that is not deployed.)
- **Files:** each path, marked (new) or (modified), one line on what changes in each.
- **Tech choices:** any library, framework, or tool gets a one-line reason (why this over the
  obvious alternative). For a nontechnical operator, mirror the plain-language version of each
  choice up in the Assumptions block.
- **Schemas / data / APIs:** show a concrete example record, request, or response in JSON, not
  field names alone.
- For non-trivial technical work, follow `technical-depth.md` (request-flow trace, data shapes,
  error shapes, annotated file tree, env-var table, risk table). Scale to the work; do not
  manufacture depth a small change does not need.

## Constraints (should-not)
Hard red lines for this work, things the build should not do even to make a test pass. Inherit the
project's own rules and the house preferences, and restate any this work could plausibly trip.
- <e.g. do not remove or weaken existing service dependencies>
- <e.g. do not silently delete real data; additive, reversible changes only>
- <e.g. do not commit secrets or a real `.env`>

## Data and safety
Does this touch stored data? If so: additive and reversible, no silent destruction, state the blast
radius of any unavoidable destructive step, and try it on a copy or test data first.

**Security (address each, or write "n/a" with the reason):**
- Who is allowed to do what (login and permissions).
- Input checking at the edges where untrusted data comes in.
- Encryption in transit and at rest where it applies.
- Secrets: which ones, kept where (a local `.env` that is never committed), and how they reach the
  app. Never in the repo.
- If this collects, processes, or shares personal or outside data, add a short table:
  Data type | Collected | Processed | Shared externally.

## Scope
### In scope (now)
- <deliverable>
### Out of scope (deliberately deferred)
- <deliberately-deferred item>: stated, not silently omitted.

## Testing
What proves it works: unit, integration, end-to-end, the frameworks, and the lint, format, and
type gates (take these from the house preferences). Tie each test back to the acceptance criteria
above, and to the project-rules check: every quoted testable rule gets a regression test. Include
how to verify the change end-to-end on the real thing: the exact command, endpoint, or run to try,
and what its output should show.

## Dependencies
What this work depends on, and what depends on it.

## Observability & done-in-production
How you will know it is working AFTER it ships: the runtime signal (a log line, a health check, a
simple status page or counter you can look at) and where you see it. If there is genuinely nothing
to observe at runtime, say so.

## Open questions
Anything undecided; mark human decisions `[@operator ...]`. A question whose answer changes the
design, the acceptance criteria, or the scope is BLOCKING: keep `status: draft` until it is
resolved. Only non-blocking nits may remain at `status: specced`.
```
