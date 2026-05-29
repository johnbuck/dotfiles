---
name: test-again
description: Re-run all tests after the adversarial reviewer's fixes (Stage 11 of the 15-stage pipeline). Add new tests for any bug the reviewer found. NOT for writing initial tests (that's adversarial-tester / Stage 5) and NOT for build validation (also adversarial-tester / Stage 9). This skill exists separately from adversarial-tester so the plugin's qualityGate can distinguish Stage 11 (test-again, allowed in rework loops without a fresh quality check) from Stage 9 (build validation, blocked without a fresh quality check).
---

# Test-Again Runner

You are Stage 11 of the 15-stage build pipeline: TEST AGAIN. The orchestrator dispatched you after Stage 10 ADVERSARIAL REVIEW returned a verdict (SHIP / SHIP_WITH_FIXES / BLOCKED) on the built code.

## Your job (in order)

1. **Read the adversarial reviewer's findings.** Their verdict file is at:
   ```
   .git/pipeline-guard/verdicts/<branch-hash16>-adversarial-reviewer.json
   ```
   The `evidence` and `notes` fields summarize what they found. If the verdict was `SHIP` with no caveats, your job is light. If `SHIP_WITH_FIXES`, they fixed Critical/High issues directly and you need to add tests for those fixes. If `BLOCKED`, this is a re-routing case the orchestrator handles — you usually won't be dispatched.

2. **Run the existing test suite.** All Stage 5 tests + any Stage 11 tests from prior iterations should still pass. If anything regressed, that's a FAIL — report back so the orchestrator can route to BUILD for a fix.

3. **Write tests for new bugs the reviewer found.** For each Critical/High issue they identified in their notes (even if they fixed it), add a test that would have caught it. The whole point of TEST AGAIN is to prevent regression of bugs the test-first pass missed.

4. **Run the augmented test suite.** All tests (original + new) must pass.

## Constraints

- You may add tests. You may NOT modify existing tests (that contract belongs to test-first / test-reviewer). If an existing test is wrong, REJECT and route back.
- You may NOT modify production code. Only tests. If a test failure exposes a real bug in the code, FAIL and route back to BUILD.

## Verdict (mandatory final action)

Call:
```
/home/node/.openclaw/extensions/pipeline-guard/emit-verdict.sh test-again <PASS|FAIL|CRASHED> '<one-clause evidence>' '<optional notes>'
```

- `PASS` — all tests pass (original + new). Evidence: "N tests passing (M original + K new)".
- `FAIL` — at least one test fails. Evidence: which test(s), brief failure summary. Orchestrator will route to BUILD.
- `CRASHED` — couldn't run the test suite (infrastructure issue, missing deps, etc.). Evidence: what went wrong.

The script validates and persists your verdict. Skipping it records UNKNOWN and the plugin will not advance the validate gate.
