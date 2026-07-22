---
name: pnk-spec
description: Use this skill to turn an idea or a piece of work into ONE clear, reviewable spec written in plain language. Triggers when the operator wants to "write a spec", "spec this out", "plan a feature", "help me plan this", "define this work", "start a new project", "kick off a project", or describes something to build that needs a written plan before code. Produces a single spec file in the project's backlog/ folder that the operator, or a later Claude Code session, can build against. For the roadmap, see pnk-roadmap; for a new code skeleton, see pnk-scaffold.
---

# pnk-spec: idea to one clear spec

This skill runs a short, plain-language interview and writes **one** spec: a single markdown
file with frontmatter, in the project's `backlog/` folder. That file is the source of truth a
person reviews, and the plan the operator or a later Claude Code session builds against.

It does not produce a separate product-doc and technical-doc pair. One project, one convention:
a backlog spec, with the technical detail folded into its Technical approach section.

## You are steering a nontechnical operator

The house preferences (`pnk-preferences.yaml`) are already in your context this session, delivered
through opencode's `instructions` array. You do not need to open that file as a first step. You do
need to **use** it: it pre-answers the technical questions so you never quiz the operator on things
they cannot answer.

The rule for every technical decision: **if the operator, or a request they pasted, stated a
preference, honor it. Otherwise take it from the preferences. Never ask a nontechnical operator to
choose a technical detail.** So "use SQLite" gets SQLite; saying nothing gets the configured stack.
If a request fits none of the named app types in the preferences, map it to the nearest one, or ask
the admin. Never free-pick a stack on your own.

Because the operator cannot check a technical section for correctness, every technical choice you
made without confirming it (from the preferences or your own judgment) goes into a plain
**"Assumptions the agent made, please check these"** block in the spec, in plain words. Do not
launder guesses into confident spec prose.

## The two rules that matter most

1. **Clarity over ceremony.** Plain words, short sentences, tables over prose. A smart reader who
   does not know this project's internals should understand the spec on one read. Define any
   technical term in plain language the first time it appears.
2. **No cryptic permanent identifiers.** Never invent codes like `C1`, `H2`, `M2`, `Step0`,
   `unitB`, `phase-3.1`. Name everything by what it is: a milestone is `live-roadmap-maintenance`,
   not `M2`. These codes become permanent and unreadable. This is not negotiable.

(No emoji before headings. Avoid em-dash-heavy prose. Leave these instructions out of the spec you
write.)

## What to ask the operator, and what to fill in yourself

Use the `question` tool when you put a real choice or a confirmation to the operator (it shows a
short list of options they can pick). For the open-ended "walk me through it" prompts below, just
ask plainly in chat. Ask in small rounds; a wall of questions is worse than a few short passes.
Only ask about the goal and the behavior. Fill the stack, database, testing, and deployment from
the preferences.

### Round one: what and why (plain language)
- What is this, in one sentence? What does it do?
- What problem does it solve, and for whom?
- Is this a brand-new project, or a change to something that already exists?
- What would "done" look like to you?

### Round two: behavior, drawn out as concrete examples
Ask for the parts only the operator can give, and ask for them as concrete examples, not as
abstractions:
- **Walk me through two or three things you would do with it, and what you would see each time.**
  (This is the main flow and the screens or outputs, in their words.)
- **What should never happen?** (This becomes the safety rules and the error behavior.)
- **If it stores anything, show me one example of a saved item**, one real record, in plain
  words. (This gives you the data shape without asking a database question.)

That is the floor, not the cap. If the answers reveal more, ask more, always in plain language.

## Ground it in what already exists first

Before writing the spec:
- **If this is a change to an existing project**, read the project's own README and its code first
  (over ssh if it lives on another machine). List what the touched part does today, element by
  element with file and line. That inventory becomes the spec's "Current behavior (as-is)" section,
  and it is what the change map dispositions. Also hunt for existing functions and patterns you can
  reuse, so the build calls them instead of reinventing them; put those in the Reuse ledger.
- **If this is a brand-new project**, there is nothing to read yet. Say so in the spec and skip the
  as-is and change-map sections.

A spec written from memory instead of from the code inherits every misremembering as a requirement.

## Scope the whole thing

Cover the complete feature, not a convenient slice. If part of it is genuinely for later, that is a
deliberate, stated line in the Scope section, never a silent omission. This pairs with simplicity:
scope the whole thing, and nothing more than the whole thing.

## Write the spec

This skill ships with reference files in its own `references/` folder. Read them by the **absolute
path opencode gives you when it loads this skill** (opencode injects this skill's own directory).
Do not read them by a bare relative path like `references/spec-template.md`, because opencode
resolves that against the project you are working in, not this skill, so it will not be found.
Concretely, read `<this skill's directory>/references/spec-template.md`.

- Read `references/spec-template.md` (at the absolute path above) for the exact structure.
- Read `references/writing-guide.md` for the writing discipline (testable acceptance criteria that
  name how they are checked, "should" not "must", "interact" not "click", every tech choice with a
  one-line reason, a concrete example record or JSON for any stored data or API).
- For non-trivial technical work, read `references/technical-depth.md` and bring the Technical
  approach section up to that bar (a request-flow trace, data shapes, error shapes, an env-var
  table, a risk table). Scale it honestly to what is actually known. If you do not know a detail,
  say so in the Assumptions block rather than inventing depth.

Write the file to **`<project>/backlog/<readable-name>.md`** (create `backlog/` if it is not there).
The filename is human-readable and describes the work. Frontmatter follows any existing specs in
the project; at a minimum: `title, status, priority, epic, area, created, tags`. Set `created` to
today's real date. Set `epic` to the readable epic name this work belongs to (see pnk-roadmap).

Fill the stack, database, gates, and deployment from the preferences (honoring any preference the
operator stated). Every one of those choices you did not confirm with the operator goes in the
Assumptions block, in plain words.

Mark anything that needs a human decision with `[@operator ...]`. Evolve the spec in place on later
changes; do not make `-v02` files.

## After writing

1. Give the operator a short **plain-language summary** of what the spec says, in a few sentences.
2. Point them at the **"Assumptions the agent made, please check these"** block and ask them to
   look it over. Use the `question` tool to confirm the main scope and any assumption that would be
   expensive to get wrong; revise if needed.
3. Tie the spec to the roadmap: if the project has no roadmap, or this work is not on it, offer to
   run **pnk-roadmap** to place it under the right epic.
4. Say plainly that the spec is ready to hand to the operator, or to a later Claude Code session,
   to build. Its testable success criteria are the contract that build works to. There is no
   automated build handoff on this machine.
