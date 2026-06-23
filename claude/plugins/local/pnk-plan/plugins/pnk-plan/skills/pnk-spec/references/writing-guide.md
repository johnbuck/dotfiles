# Writing guide — the discipline carried over from PRD/TRD work

How to write a backlog spec well. These are the keepers from years of PRD/TRD practice, minus
the heavy two-document ceremony.

## Voice
- Write plainly and clearly, as if you want to be understood. Casual but precise.
- Short sentences. Plain words. No flowery language, no filler.
- Define a technical term in plain language the first time it appears.
- Avoid em-dash-heavy prose. Avoid emoji before headings.
- Jargon only where it is the genuinely precise term — never as decoration.

## Names and identifiers (the hard rule)
- Name everything by what it IS. A milestone is `live-roadmap-maintenance`, not `M2`. A
  workstream is `wiley-migration`, not `C1`. A phase is `red-tests-first`, not `Step0`.
- Cryptic codes ossify into permanent, unreadable identifiers. Never create them.

## Requirements
- Use "should", not "must".
- Use "interact" / "interaction", not "click" / "tap" (standard terms like "click-through
  rate" are fine).
- Every acceptance criterion states HOW it is verified (a test, a command + expected
  output/exit code, an HTTP status, a file, or a log line). A criterion with no named
  verification is not acceptable — move it to Behavior or cut it.
- One assertion per criterion — no compound "X and Y" criteria.
- Give each criterion a short readable kebab-case handle (e.g. `rejects-expired-token`) that
  tests and the as-built record cite — stable across reorder, and never a cryptic code.
- At least one acceptance criterion covers a failure/error path. Happy-path-only is rejected.
- Given/When/Then scenarios are good for clarifying behavior. Cover the happy path and the
  edge/error cases. Don't write them where a plain sentence is clearer.

## Technical choices
- Every library / framework / tool choice gets a one-line rationale: why this over the obvious
  alternative.
- For any data schema or API, show a concrete example — an actual JSON record, request, and
  response — not just a list of field names.

## Scope and completeness
- Scope the COMPLETE feature. Necessary work is not punted to an unscoped "later".
- Anything deferred is a deliberate, stated decision in "Out of scope", never a silent gap.
- Simplicity is the other half: scope the whole thing, and nothing beyond it. No speculative
  abstractions or unrequested configurability.
- **Right-size to one mergeable change.** One spec = one epic, one coherent diff. If acceptance
  criteria run well past ~10, or the work spans multiple epics, split it into separate specs and
  let the roadmap sequence them. "Also, we should…" is the signal for a second spec.

## Blocking questions gate the status
- A question whose answer changes the design, acceptance criteria, or scope is BLOCKING. Keep
  `status: draft` while one is open; only move to `specced` once they're resolved. pnk-baton
  should not build a spec with open blocking questions.

## Success metrics
- Identify what to measure, not prescriptive targets.

## Human follow-ups
- Mark anything that needs a human decision or asset with `[@humanUser description]`.

## Data stewardship (operator standing rules)
If the work touches persisted data or infrastructure, the spec must reflect: additive /
reversible / idempotent operations; overwrite in place over delete; snapshot before any
unavoidable destruction; state the blast radius before a destructive/bulk step; never discard
data or assume it's worthless without full context and explicit permission; validate on staging
or non-prod before touching production. The repo's CLAUDE.md / NORTH_STAR may add stricter
rules — those win.
