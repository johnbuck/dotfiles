---
description: Run a spec through the pnk-baton multi-agent build pipeline (plan → test → build → review → optional validate)
argument-hint: <spec-path> [--validate] [--base <branch>] [--ssh <user@host>] [--worktree <path>] [--require-roadmap] [--north-star <path>] [--roadmap <path>]
---

Run the **pnk-baton** build pipeline on the spec/task at: `$ARGUMENTS`

## HARD RULE — never destroy or redo completed work (operator, emphatic)

A baton run that BLOCKS / fails validation / fails integration has still **built a complete, self-tested
feature on its branch**. The failure means it could not *merge* — NOT that the work is wrong. Therefore:

- **NEVER delete the worktree or branch of a failed/blocked run** (`git worktree remove`, `git branch -D`).
  That throws away hours of work and hundreds of thousands of tokens. The branch is the salvage point.
- **NEVER rebuild a phase from scratch when a build already exists.** Reuse the completed work:
  1. If the block is a PRE-EXISTING / unrelated / concurrent-churn failure (another epic's breakage on
     `base`, not this branch's code) — surface it and get that shared blocker resolved properly by its
     owner; never delete or weaken tests to force a green. Once `base` is healthy, **merge the existing
     branch** (it built green; only the merge gate tripped on something not ours).
  2. If a real finding must change the code — **fix-forward on the existing branch**, or re-run with
     `Workflow({ scriptPath, resumeFromRunId })` so completed agent stages return cached results instead of
     re-running. Do NOT launch a fresh run on a fresh worktree that ignores the prior build.
  3. Only start clean if there is genuinely no prior build to reuse.
- A branch/worktree is removed ONLY after its work is safely merged to `base`, or the operator explicitly
  says to abandon it. Even then prefer keeping the branch.
- **Recovery:** a deleted branch's commits survive in git until GC (~2 weeks). Recover with
  `git branch <name> <sha>` (sha from the "Deleted branch X (was <sha>)" line, or `git reflog` /
  `git fsck --lost-found`).

Steps:
1. Resolve inputs:
   - `spec` = the spec/task path from the arguments (the first non-flag token). If the user passed a description instead of a file, treat the whole argument string as the task text.
   - `repo` = the git repository root. **Local (default):** `git rev-parse --show-toplevel` of the current working directory. **Remote (`--ssh`):** the repository root path ON the remote host — do NOT run a local `git` for it; resolve/confirm it over ssh.
   - `validate` = true only if `--validate` is present in the arguments.
   - `base` = the value after `--base` if present, else `main`.
   - `ssh` = the value after `--ssh` if present (e.g. `wiley@wiley-pinkleberry`), else omit. When set, EVERY pipeline stage operates on the repo **on that host over ssh** — repo/worktree/files/git/tests all live there, nothing is copied locally.
   - `worktree` = the value after `--worktree` if present — the absolute path for the per-run worktree. Use this with `--ssh` to place the worktree where the remote test harness can see it (e.g. under the repo, if the test container mounts the repo). Else omit (defaults to a sibling `.pnk-baton-worktrees/` dir).
   - `requireRoadmap` = true only if `--require-roadmap` is present. When set, a missing canonical roadmap is a hard failure; default is warn-and-continue.
   - `northStar` = the value after `--north-star` if present — an explicit path to the project's North Star/vision doc. Else omit (the drift-checker auto-discovers it).
   - `roadmap` = the value after `--roadmap` if present — an explicit path to the canonical roadmap. Else omit (auto-discovered).
2. Invoke the **Workflow** tool with `name: "pnk-baton"` and `args: { spec, repo, base, validate, ssh, worktree, requireRoadmap, northStar, roadmap }` (omit any flag not provided).
3. When it returns, relay the result concisely: the feature branch name, the gate outcomes (plan criteria count, alignment pre/post-build, tests, review PASS/REJECT, validation), and the exact merge command from the `note` field. Do NOT merge automatically — pnk-baton produces a reviewed branch; the user ships it.

If the workflow returns `status: "BLOCKED"` or `"VALIDATION-FAILED"`, surface the outstanding findings and stop — do not paper over them. **Per the HARD RULE above, keep the branch and reuse its build** (merge-after-fixing-the-shared-blocker, fix-forward, or resume); do not delete it or rebuild from scratch. If it returns `"DRIFT-HALT"` (pre-build) or `"DRIFT-BLOCKED"` (post-build), surface the alignment findings from the `findings`/`drift` fields and stop — the work has drifted from the spec/roadmap/North Star and the operator must reconcile scope before it ships; if the drift is that the work isn't on the roadmap or the spec itself is the problem, offer to run the **pnk-roadmap** or **pnk-spec** skill to reconcile, then re-run pnk-baton (it re-integrates). If it returns `"ROADMAP-MISSING"`, report that no canonical roadmap was found and `--require-roadmap` was set; the branch is built but unmerged pending a roadmap — offer to run the **pnk-roadmap** skill to create one, then re-run pnk-baton.

This is the consumer half of a producer→consumer pair: the **pnk-plan** plugin (skills `pnk-spec`, `pnk-roadmap`, `pnk-scaffold`) produces the spec + roadmap artifacts that pnk-baton builds and the drift-checker enforces.
