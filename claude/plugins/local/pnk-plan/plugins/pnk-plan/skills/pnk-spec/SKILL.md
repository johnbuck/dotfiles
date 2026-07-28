---
name: pnk-spec
description: Use this skill to turn an idea or a piece of work into ONE clear, reviewable backlog spec. Triggers when the user wants to "write a spec", "spec this out", "define this work", "plan a feature", "start a new project", "kick off a project", "do specs", or describes something to build that needs a written spec before code. Produces a single backlog-style markdown file with frontmatter in the repo's backlog/ — the artifact pnk-baton's planner and drift-checker consume. For the roadmap, see pnk-roadmap; for greenfield code skeletons, see pnk-scaffold.
---

# pnk-spec — idea to one clear backlog spec

This skill runs a short, structured interview and writes **one** backlog spec: a single
markdown file with frontmatter, in the target repo's `backlog/` directory. That file is the
source of truth a human reviews and that `pnk-baton` builds against. The drift-checker reads it
to confirm the work doesn't stray from it.

It does **not** produce a PRD/TRD pair. One repo, one convention: backlog specs.

## The two rules that matter most

1. **Clarity over ceremony.** Plain words, short sentences, tables over prose. A smart reader
   who doesn't know this system's internals should understand the spec on one read. Define any
   technical term in plain language the first time it appears.
2. **No cryptic permanent identifiers.** Never invent codes like `C1`, `H2`, `M2`, `Step0`,
   `unitB`, `phase-3.1`. Name everything by what it *is* — a milestone is
   `live-roadmap-maintenance`, not `M2`; a workstream is `wiley-migration`, not `C1`. These
   codes become permanent and unreadable. This is non-negotiable.

(No emoji before headings. Avoid em-dash-heavy prose. Exclude any of these instructions from
the spec you write.)

## Questioning approach

Use the **AskUserQuestion** tool for every decision — not plain-chat questions. Ask in
progressive rounds: start broad, get specific as the picture forms. Up to 4 questions per call,
2–4 options each, `multiSelect` where choices aren't exclusive. Several short rounds beat one
wall of questions. Only assume well-established industry patterns; internal preferences always
get a question.

### Round 1 — what and why
- What is this, in one sentence? What does it do?
- What problem does it solve, and for whom?
- Is this new work in an existing repo, or a brand-new project?
- What does "done" look like at a high level?

### Round 2 — behavior
- Walk the primary use case step by step.
- Secondary use cases and edge cases.
- What should happen when things go wrong?
- Hard constraints (must run offline, must integrate with X, data limits, etc.).

### Round 3 — technical direction
- Stack / approach preferences, or decide during the spec?
- What data does it touch, and where does that data live?
- External services or APIs it must talk to?
- Deployment / where it runs (which host, path, ports).
- For anything non-trivial, sketch 2–3 viable approaches (one line each, pros/cons), then
  propose ONE with reasoning and confirm it — don't pick silently. The alternatives live in
  this conversation only: the WRITTEN spec carries the chosen approach, with at most a one-line
  "chosen over X because Y" — a spec listing multiple selectable options makes the builder pick.

### Round 4 — security and data
- Data sensitivity (public, internal, contains secrets/PII).
- Auth model, input validation, secrets handling.
- **Data stewardship:** does this work touch persisted data? If so, confirm it is additive /
  reversible, never silently destructive, and validated on staging first. (These are operator
  standing rules — see the repo's CLAUDE.md / NORTH_STAR.)

### Round 5 — testing and quality
- What proves it works: unit, integration, end-to-end.
- Test framework(s), linter/formatter, type checking.
- Any monitoring/observability the work needs.

Three rounds is the floor, not the cap. If answers reveal complexity, ask more.

## Ground in the code first — understand, then reuse, then write

Before writing a word of spec, read the actual code (over ssh if the repo is remote):

1. **Inventory the touched surface** — what the code path does today, element by element with
   file:line (this becomes the spec's "Current behavior (as-is)" section).
2. **Hunt for reuse** — actively search for existing functions, utilities, and patterns that can
   serve this work. Propose new code only where no suitable implementation exists; what you find
   goes in the spec's Reuse ledger so the builder calls it instead of reinventing it.
3. **Read the North Star / canon for the touched surface** — the governing rules, quoted at
   write time (this becomes the "North Star check" section).

A spec written from conversation memory instead of the code inherits every misremembering as a
requirement.

## FULLY INVESTIGATE — every assertion is verified, not assumed

**This is the highest-leverage rule in the skill.** An unverified claim does not fail cheaply.
It fails at pnk-baton's Align gate, after the pipeline has spun up planner, test-author and
builder, and it costs a FULL BUILD CYCLE to discover. Several halts in a row cost more than the
feature. Reading three files carefully now is the cheapest work available to you.

"I read the code" is not the bar. All of the failures below passed that bar and still halted a
build. Before you assert anything in a spec, verify it:

- **Every caller of anything you change.** A shared helper serves more than one path. Grep its
  callers and name each one. (Real halt: a fix scoped to a "fallback" path actually landed in a
  builder shared with the primary path, silently changing production behavior elsewhere.)
- **Every consumer keyed on what you change.** If you re-key a node, a record or an id, find
  every downstream operation that matches on the old key. (Real halt: an event was re-keyed but
  five co-writes still matched on the old name, so their edges would have silently vanished.)
- **The signature of every function your spec's code calls.** Does it actually accept that
  argument today? (Real halt: the spec called a function with a connection parameter the
  function did not have.)
- **The real semantics of any external API you depend on.** Do not assume a return value's
  meaning or range. (Real halt: a vector index returns a NORMALIZED score, not raw cosine, so
  the proposed threshold silently admitted matches far below the intended bar.)
- **That code you propose to move or reorder still works in the new position.** (Real halt: a
  spec reordered a function that matches on already-persisted rows to run before those rows
  exist, which would have silently disabled the feature.)
- **The existing conventions on the surface.** Grep how sibling code already handles the same
  concern. (Real halt: a new query omitted the soft-retired filter every other read applies.)
- **Every canon quote, by opening the file.** Quote verbatim from the real file. Never
  reconstruct a rule from memory, and never invent one.

Cite what you verified with file:line. If you cannot verify a claim, it does not go in the spec
as fact: either investigate until you can, or write it in Open questions as an explicit unknown.

## GET CLARITY — ask rather than guess

Investigation resolves what the code can tell you. It cannot tell you what the operator wants.

When a decision could reasonably go two ways and the two ways produce materially different work,
**stop and ask with AskUserQuestion**. A guess here is not a small risk: it becomes a written
requirement, the builder implements it faithfully, and the cost surfaces only at review or in
production. One question costs a few seconds. A wrong assumption costs a build cycle, and a
wrong assumption that ships costs more.

Ask when: the scope boundary is unclear; a threshold, limit or default has no obvious right
value; there is a real trade-off between safety and speed; the change touches data that cannot
be cleanly reverted; or your investigation surfaced something the operator may not know about.
Bring what you found, state a recommendation, and let them rule.

Do not ask about things the code already answers. Investigate those.

## Completeness — scope the WHOLE feature

Before writing, make sure the spec covers the **complete** feature, not a convenient slice.
The operator's standing rule: build the complete and best version; necessary work is not punted
to an unscoped "later." If part of the feature is genuinely out of scope for now, that is a
deliberate, stated decision in the Scope section — never a silent omission. (This pairs with
simplicity: scope the whole thing, and nothing more than the whole thing.)

## Writing the spec

Read `references/spec-template.md` for the exact structure and `references/writing-guide.md` for
the writing discipline carried over from PRD/TRD practice (testable acceptance criteria that name
their verification, "should" not "must", "interact" not "click", tech choices with a one-line
rationale, concrete example records/JSON for any schema or API). For non-trivial technical work,
read `references/technical-depth.md` and bring the Technical approach section up to that bar
(architecture trace, data/store shapes, error schemas, env-var table, risk table) — scaled to
the work.

Write the file to **`<repo>/backlog/<readable-name>.md`** (create `backlog/` if absent). The
filename is human-readable and describes the work; if the repo uses a priority prefix
(`P2-…`), follow it. Frontmatter follows the repo's existing specs — at minimum:
`title, status, priority, epic, area, created, tags`. Set `created` to today's actual date.
Set `epic` to the readable epic name this work belongs to (see pnk-roadmap — epics live there).

Mark anything needing a human decision with `[@humanUser …]`. Evolve the spec in place on later
changes (no `-v02` files); baton's documenter appends the as-built record after the build.

## After writing — confirm, then hand off

1. Use AskUserQuestion to confirm the major scope and approach choices; revise if needed.
2. Tie the spec to the roadmap: if the repo has no roadmap, or this work isn't on it, offer to
   run **pnk-roadmap** to place it under the right epic (the drift-checker enforces work against
   the roadmap, so this matters).
3. Offer to hand the finished spec to **pnk-baton** to build it
   (`/pnk-baton <path-to-spec>`). The spec's testable success criteria become baton's contract.
