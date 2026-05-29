# The Build Pipeline — 15 Stages, No Skips

Every software change goes through all fifteen stages. No exceptions.

This pipeline is **agent-agnostic**: any agent that loads `pipeline-orchestrator/SKILL.md` becomes the orchestrator for that build — an OpenClaw bot (Juliet, Yui, Akane), a Claude agent on a workstation, or any future agent with the `pipeline-guard` plugin installed. The orchestrator drives the build to completion themselves, dispatches one subagent per stage, waits, evaluates, and **reports a one-line status to the operator after every stage** before dispatching the next. No fire-and-forget orchestrator subagents; no parallel stages; no silent loops.

---

## 1. SPEC

What are we building and why? Two modes:

### Mode A — New Feature

- **Stakeholder interview** — talk to the user (or relevant stakeholder) to capture all context, goals, constraints, and edge cases. Don't assume — ask. Confirm understanding back to them before building.
- **Exact end state and goal** — not vague. "After this ships, X does Y and we can verify it by Z."
- **Success criteria** as testable assertions
- **Scope** — what's in, what's explicitly out

### Mode B — Bug Fix / Diagnosis

- **Reproduce** — confirm the bug exists. Capture exact symptoms, error messages, stack traces.
- **Diagnose root cause** — trace the code path. Identify every location where things go wrong. Don't stop at the first symptom — find the underlying cause.
- **Risk assessment** — what's the blast radius? What data or functionality is at risk? What happens if the fix goes wrong?
- **Backup / rollback plan** — before any fix ships, how do we recover? Database backups, feature flags, revert plan. Every bug fix spec MUST include a rollback strategy.
- **Write fix spec** — same format as Mode A: testable success criteria, scope, implementation plan. The fix must address root cause, not just symptoms.

### Both Modes Must Include

- **Success criteria** as testable assertions
- **Scope** — what's in, what's explicitly out
- **Risk assessment** — what could go wrong, how likely, how bad
- **Rollback plan** — how to undo if it breaks (even for new features)
- **NORTH_STAR.md compliance section** — for each principle, "honored" or "compromised because [reason]"

Specifications live at: `backlog/YYYY-MM-DD-short-description.md`

Nobody writes code without a spec that's been confirmed with the stakeholder.

## 2. SPEC REVIEW

A separate agent reviews the spec against every principle in `NORTH_STAR.md`. Issues PASS / PASS WITH NOTES / REJECT. REJECT routes back to Stage 1.

## 3. ARCHITECTURE

A system-architect subagent — distinct from the spec author and from the architecture reviewer — produces the design: public interfaces, data flow, failure modes, migration plan, extension points, alternatives considered. Written as a `## Design` section in the spec or a sibling `design.md`. For trivial changes, the architect still runs and produces a one-line "no architectural change" attestation. Self-attesting via "no design needed" is forbidden.

## 4. ARCHITECTURE REVIEW

A separate agent reviews the design against `NORTH_STAR.md` (extra weight on principles 5, 6, 8). PASS / PASS WITH NOTES / REJECT. REJECT routes back to Stage 3.

## 5. TEST-FIRST

Write the tests BEFORE the code. Tests define what "done" means.

- Test against real infrastructure where possible — mock only external services you can't control (third-party APIs, payment systems)
- When mocking IS necessary: **mock at the lowest reasonable layer** (HTTP transport, not business logic functions). Mocking the function you're testing tests nothing.
- Assert specific, meaningful output — not just "returns something"
- Cover the success criteria from the spec
- All fail initially (that's the point — they define the target)

## 6. TEST REVIEW

A **separate agent** from the tester validates that the tests actually test what they claim.

- Do the mocks bypass the code path under test?
- Are assertions checking real behavior or just checking mock returns?
- Would the test still catch a real bug if the implementation changed?
- Is the test testing at the right layer? (HTTP mock > function mock > no mock)
- Does every test map to a specific success criterion from the spec?

**Gate:** If tests don't pass review, they go back to TEST-FIRST. No building against weak tests.

## 7. BUILD

Write the minimum code to make the tests pass.

- Read existing patterns first
- Follow project conventions
- Iterate until tests go green
- Self-check: does it run? Does the output look right?
- **Builder CANNOT modify tests.** If a test is wrong, the builder stops and reports back. Only the tester or test reviewer can change tests.

## 8. CODE QUALITY

Static analysis, lint, type-check, coverage, dependency check, secret scan, suppression diff. PASS / PASS WITH NOTES / REJECT. REJECT routes back to Stage 7.

## 9. BUILD VALIDATION

Run the original, unmodified tests against the built code.

- All TEST-FIRST tests must pass without modification
- If the builder changed any test file → **reject**, back to BUILD
- Verify test results match expectations from the spec

## 10. ADVERSARIAL REVIEW

Someone else reads the code AND the tests assuming both contain bugs.

- Security issues, logic errors, edge cases, architectural violations
- Observability check (does this change emit logs/metrics/traces needed to debug at 3am?)
- **Test quality review:** do tests cover the real code paths? Any gaps?
- Re-checks NORTH_STAR.md compliance against the actual code
- Fixes Critical/High issues directly in the code
- Reports all findings with severity ratings (C/H/M/L)
- Verdict: SHIP / SHIP WITH FIXES / BLOCKED. BLOCKED routes back to Stage 7.

## 11. TEST AGAIN

Re-run all tests after review fixes.

- If anything broke → back to BUILD
- Write additional adversarial tests for bugs the reviewer found
- All tests must pass

## 12. VALIDATE

Run the full pipeline end-to-end against real infrastructure.

- LLM calls, search APIs, databases — all live
- Output must be meaningful and correct, not just non-crashing
- Confirms public-facing docs/READMEs/runbooks reflect the change (or explicitly states "no public surface changed")
- Confirms relevant lessons learned are written down (memory, recall, incident reports as applicable)
- If validation fails → back to BUILD

## 13. PRE-MERGE INTEGRATION

Merge `origin/main` INTO the feature branch with `git merge --no-ff` (NO REBASE). On conflict: abort and HALT — escalate to operator. On clean merge: re-run BUILD VALIDATION and VALIDATE on the integrated code. Routes back to Stage 7 on validation failure.

## 14. SHIP (serialized)

`ship.sh` acquires the global merge lock (`flock` on `/home/node/.openclaw/.pipeline-guard/ship.lock`, 10-min wait), confirms Stage 13 just passed, fast-forwards `main`, pushes. Only one pipeline ships at a time. Non-zero exit = stop and report; do not retry blindly.

## 15. POST-MERGE VERIFY

Pull `main` fresh on a clean checkout (NOT the feature worktree). Re-run BUILD VALIDATION and VALIDATE. Smoke-test the deployed surface from the spec. Confirm observability is producing data. **If any check fails, REVERT the merge commit immediately and report.** PASS / FAILED-AND-REVERTED.

The pipeline is **not done at SHIP**. Stage 15 is the final gate — a green pre-merge that goes red on `main` is the failure mode this stage exists to catch.

On PASS: orchestrator moves the spec file to `backlog/done/`. The done/ archive is the truth-of-record for what's shipped.

---

## Rules

- **No stage is optional.** No skipping review because "it's a small change."
- **A subagent does each stage** — never self-review your own code. The orchestrator coordinates; subagents execute. NORTH_STAR principle 12 (no agent works alone) is non-negotiable.
- **The orchestrator does not work in parallel.** One stage subagent in flight at a time. The orchestrator waits, evaluates, reports a one-line status to the operator, then dispatches the next stage.
- **Git: feature branch for each change**, merge after all stages pass. Never commit to main directly.
- **Tests are the contract.** If the spec says "X does Y," there's a test that proves it.
- **Builder never touches tests.** If tests are wrong, builder stops and escalates.
- **If a stage fails twice, the orchestrator stops and reports back** to the operator. No silent retry loops.
- **Branch names are deterministic per spec.** A given spec always maps to the same branch (`<prefix>/<spec-filename-stem>` — see `pipeline-orchestrator/SKILL.md` § *Branch Naming*). No timestamps, no attempt counters, no session IDs in branch names. The whole resumption story depends on this collision.
- **Resume; don't restart.** Before dispatching anything, the orchestrator checks whether the branch already exists and whether prior commits map to completed stages (see `pipeline-orchestrator/SKILL.md` § *Resumption*). Stage subagents check `git log --oneline main..HEAD` before starting work and report back if their stage's output is already on the branch. **Subagents never create branches** — that's the orchestrator's call, executed by the `pipeline-guard` plugin's worktree allocation. A subagent that finds itself on the wrong branch stops and reports.
- **Worktrees are reused, not recreated.** The `pipeline-guard` plugin allocates one canonical worktree per branch and reuses it across stages and across orchestrator sessions. A new orchestrator picking up an existing spec finds the existing worktree (and its prior commits) intact.
- **Specs declare lifecycle and validation target.** YAML frontmatter (v0.19+): `status: ready|draft|abandoned` (orchestrator refuses non-ready without operator override), `validation_target: staging|prod|none` (validator stages default to staging — they MUST use `*_TEST` env vars unless the spec explicitly justifies prod). Pre-v0.19 specs are treated as `status: ready, validation_target: staging` with a NOTE-level warning.
- **Stage outputs follow a structured contract.** Every stage subagent ends its response with a fenced `## Stage Result` JSON block declaring `{verdict, evidence, notes, next_action}`. The plugin parses this and persists `lastVerdict` to `branchState`. Missing/malformed JSON → verdict recorded as `UNKNOWN` and the orchestrator should treat the run as non-completion.
- **Only the orchestrator spawns subagents.** Stage subagents can use any non-spawn tool (Read, Grep, Bash, memory_search, recall__*) but cannot call `sessions_spawn`. The plugin enforces this via `pipelineGate`'s no-spawn rule.
- **Specs are pinned by hash during a build.** First stage dispatch records sha256(spec) in `branchState.specHash`. Subsequent dispatches warn if the hash changes — operator should confirm whether prior reviews still apply.
- **Pipeline is recoverable.** Operator can run `pipeline-guard/abort.sh <branch>` to clear a stuck pipeline, `pipeline-guard/status.sh` to see what's happening, `pipeline-guard/reap.sh` to garbage-collect merged-and-quiet worktrees, `pipeline-guard/validate-spec.sh <spec>` to check spec format before kicking off.

## Stage Mapping

| Stage | Skill | Agent |
|-------|-------|-------|
| 1. SPEC | (interview / diagnosis) | Operator + orchestrator (orchestrator may write the spec for a bug fix) |
| 2. SPEC REVIEW | `pipeline-guard/skills/spec-reviewer/SKILL.md` | Spec-reviewer subagent |
| 3. ARCHITECTURE | `pipeline-guard/skills/system-architect/SKILL.md` | System-architect subagent |
| 4. ARCHITECTURE REVIEW | `pipeline-guard/skills/architecture-reviewer/SKILL.md` | Architecture-reviewer subagent |
| 5. TEST-FIRST | `pipeline-guard/skills/adversarial-tester/SKILL.md` | Tester subagent |
| 6. TEST REVIEW | `pipeline-guard/skills/test-reviewer/SKILL.md` | Test-reviewer subagent (NOT the tester) |
| 7. BUILD | `pipeline-guard/skills/builder/SKILL.md` | Builder subagent |
| 8. CODE QUALITY | `pipeline-guard/skills/code-quality-checker/SKILL.md` | Code-quality subagent |
| 9. BUILD VALIDATION | `pipeline-guard/skills/adversarial-tester/SKILL.md` | Tester subagent (build-validation pass) |
| 10. ADVERSARIAL REVIEW | `pipeline-guard/skills/adversarial-reviewer/SKILL.md` | Adversarial-reviewer subagent |
| 11. TEST AGAIN | `pipeline-guard/skills/adversarial-tester/SKILL.md` | Tester subagent (test-again pass) |
| 12. VALIDATE | `pipeline-guard/skills/validator/SKILL.md` | Validator subagent |
| 13. PRE-MERGE INTEGRATION | `pipeline-guard/skills/integration-validator/SKILL.md` | Integration-validator subagent |
| 14. SHIP | `pipeline-guard/ship.sh` | Orchestrator runs the script (serialized via global lock) |
| 15. POST-MERGE VERIFY | `pipeline-guard/skills/post-merge-validator/SKILL.md` | Post-merge-validator subagent |

The orchestrator at every stage is **the agent that loaded `pipeline-orchestrator/SKILL.md`** — they dispatch each subagent above, wait for the return, evaluate, report a one-line status, then dispatch the next.

## Why 15 stages?

The 9-stage pipeline let architecture drift into the build with no separate review, allowed builders to ship without a code-quality pass, and treated SHIP as the finish line. Stages 2 (SPEC REVIEW), 3+4 (ARCHITECTURE + ARCHITECTURE REVIEW), 8 (CODE QUALITY), 13 (PRE-MERGE INTEGRATION), and 15 (POST-MERGE VERIFY) close those gaps. Three separate agents now touch every test/code boundary; the architecture and integration boundaries each have their own dedicated reviewer; SHIP is no longer the finish line — POST-MERGE VERIFY is.

## Why agent-driven (not orchestrator-subagent)?

Earlier versions of this pipeline had the calling agent (e.g. Juliet) spawn a `pipeline-orchestrator` subagent that ran all 15 stages itself, then returned a single summary at the end. That pattern lost real-time visibility (the operator saw nothing until the orchestrator subagent finished, sometimes hours later) and allowed multiple orchestrators to run in parallel for independent specs without the operator's knowledge. Making the calling agent itself the orchestrator restores per-stage visibility, serializes parallel builds back through the operator's awareness, and removes a layer of indirection without changing any gate.
