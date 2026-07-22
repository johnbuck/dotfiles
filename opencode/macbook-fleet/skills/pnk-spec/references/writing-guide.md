# Writing guide: the discipline for a good spec

How to write a backlog spec well. These are the keepers from years of planning practice, without
the heavy two-document ceremony.

## Voice
- Write plainly and clearly, as if you want to be understood. Casual but precise.
- Short sentences. Plain words. No flowery language, no filler.
- Define a technical term in plain language the first time it appears.
- Avoid em-dash-heavy prose. Avoid emoji before headings.
- Jargon only where it is the genuinely precise term, never as decoration.
- Remember the operator is nontechnical: anything they need to check should read plainly, and the
  technical guesses you made belong in the "Assumptions the agent made" block, not hidden in
  confident prose.

## Names and identifiers (the hard rule)
- Name everything by what it IS. A milestone is `live-roadmap-maintenance`, not `M2`. A workstream
  is `data-import`, not `C1`. A phase is `tests-first`, not `Step0`.
- Cryptic codes harden into permanent, unreadable identifiers. Never create them.

## Ground truth before prose (the discipline that prevents drift)
- **Inventory before you change.** A spec that changes something that already exists starts by
  READING the actual code and listing what the path does today (every filter, limit, guard, gate,
  fallback, branch, with file:line). You cannot correctly scope a change to a surface you have not
  inventoried; the gaps in the inventory become the builder's silent guesses. A brand-new project
  has nothing to inventory, so say so.
- **Disposition everything.** Every inventoried element is explicitly KEEP, CHANGE, or REMOVE in
  the change map. Unlisted means KEEP. REMOVE lines are the only deletions the build is authorized
  to make; "the builder needed to drop it for performance" is drift, not a decision.
- **Quote the project's rules, do not recall them.** Any sentence that cites the project's README,
  a conventions doc, or an existing pattern quotes it with the file path, verified by reading the
  file at write time. If you cannot point at the line, do not call it a rule; go read it or ask. A
  from-memory paraphrase labeled as a rule is how made-up rules get into specs.
- **Check the project's rules while writing, not after shipping.** Read the project's README and
  existing conventions for the area you touch at spec time; quote the governing rules (file-checked)
  and state how the change complies. Each testable rule becomes a regression test. If a needed rule
  is missing from the project's docs, surface it as a deliberate README update for the operator; do
  not invent a spec-local rule, which has no authority and can lock in a bug.

## Requirements
- Use "should", not "must".
- Use "interact" or "interaction", not "click" or "tap" (standard terms like "click-through rate"
  are fine).
- Every acceptance criterion states HOW it is verified (a test, a command plus expected output or
  exit code, an HTTP status, a file, or a log line). A criterion with no named verification is not
  acceptable; move it to Behavior or cut it.
- One assertion per criterion; no compound "X and Y" criteria.
- Give each criterion a short readable kebab-case handle (e.g. `rejects-expired-token`) that tests
  cite; stable across reorder, and never a cryptic code.
- At least one acceptance criterion covers a failure or error path. Happy-path-only is rejected.
- Given/When/Then scenarios are good for clarifying behavior; cover the happy path and the edge and
  error cases. Do not write them where a plain sentence is clearer.

## Technical choices
- Every library, framework, or tool choice gets a one-line reason: why this over the obvious
  alternative. Take the default from the house preferences unless the operator stated otherwise.
- For any data shape or API, show a concrete example (an actual JSON record, request, and response),
  not just a list of field names.

## Plan-mode specificity (the bar for the technical section)
A clear summary of the approach; ordered files to modify with specific changes; step-by-step
implementation order; testing and verification; risks and mitigations.
- The technical approach is an implementation plan, not a description: exact file:line touch points
  from reading the code, and the actual code to write for anything non-trivial (a build-ready
  appendix for long code). History is clear here: the specs that carried exact queries and code
  built cleanly; the specs that described behavior in prose drifted.
- **Concise enough to scan quickly, detailed enough to execute effectively.** Both halves are the
  bar. For a pattern repeated across many files, describe the pattern once and list a few
  representative paths.
- **Recommended approach only.** The written spec carries the one chosen design; an alternative
  considered gets a one-line "chosen over X because Y" at most.
- **Reuse before invention.** Search the code for existing functions, utilities, and patterns
  first; the spec names what it reuses (with paths) and proposes new code only where nothing
  suitable exists.
- When the work comes from a prototype, the prototype's dialed-in code and interaction mechanics
  are embedded verbatim as the build contract; the builder ports faithfully, never re-derives.

## Scope and completeness
- Scope the COMPLETE feature. Necessary work is not punted to an unscoped "later".
- Anything deferred is a deliberate, stated line in "Out of scope", never a silent gap.
- Simplicity is the other half: scope the whole thing, and nothing beyond it. No speculative
  abstractions or unrequested configurability.
- **Right-size to one mergeable change.** One spec is one epic, one coherent diff. If acceptance
  criteria run well past about ten, or the work spans multiple epics, split it into separate specs
  and let the roadmap sequence them. "Also, we should..." is the signal for a second spec.

## Blocking questions gate the status
- A question whose answer changes the design, the acceptance criteria, or the scope is BLOCKING.
  Keep `status: draft` while one is open; only move to `specced` once they are resolved.

## Success metrics
- Identify what to measure, not prescriptive targets.

## Human follow-ups
- Mark anything that needs a human decision or asset with `[@operator description]`.

## Data stewardship (standing rules)
If the work touches stored data or infrastructure, the spec should reflect: additive, reversible,
idempotent operations; overwrite in place over delete; snapshot before any unavoidable destruction;
state the blast radius before a destructive or bulk step; never discard data or assume it is
worthless without full context and explicit permission; try changes on a copy or test data before
touching the real thing. The project's own README or the house preferences may add stricter rules;
those win.
