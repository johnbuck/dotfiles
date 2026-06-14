---
description: Run a spec through the pnk-baton multi-agent build pipeline (plan → test → build → review → optional validate)
argument-hint: <spec-path> [--validate] [--base <branch>]
---

Run the **pnk-baton** build pipeline on the spec/task at: `$ARGUMENTS`

Steps:
1. Resolve inputs:
   - `spec` = the spec/task path from the arguments (the first non-flag token). If the user passed a description instead of a file, treat the whole argument string as the task text.
   - `repo` = the git repository root of the current working directory (run `git rev-parse --show-toplevel`).
   - `validate` = true only if `--validate` is present in the arguments.
   - `base` = the value after `--base` if present, else `main`.
2. Invoke the **Workflow** tool with `name: "pnk-baton"` and `args: { spec, repo, base, validate }`.
3. When it returns, relay the result concisely: the feature branch name, the gate outcomes (plan criteria count, tests, review PASS/REJECT, validation), and the exact merge command from the `note` field. Do NOT merge automatically — pnk-baton produces a reviewed branch; the user ships it.

If the workflow returns `status: "BLOCKED"` or `"VALIDATION-FAILED"`, surface the outstanding findings and stop — do not paper over them.
