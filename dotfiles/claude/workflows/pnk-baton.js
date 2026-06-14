export const meta = {
  name: 'pnk-baton',
  description: 'Multi-agent build/review pipeline in an isolated worktree: plan -> test-first -> build -> integrate -> adversarial review (parallel dimensions) -> optional validate -> auto-merge. Single writer; author != reviewer.',
  whenToUse: 'A non-trivial build, fix, or refactor you want run through plan/test/build/review gates with context kept out of the main session. Safe to run several at once — each gets its own worktree.',
  phases: [
    { title: 'Setup', detail: 'create an isolated per-run git worktree' },
    { title: 'Plan', detail: 'planner turns the spec into a testable design' },
    { title: 'Test', detail: 'test-author writes failing tests (red)' },
    { title: 'Build', detail: 'builder makes tests pass (green); loops with review' },
    { title: 'Integrate', detail: 'merge latest base into the branch' },
    { title: 'Review', detail: 'independent reviewers, one per dimension, in parallel' },
    { title: 'Validate', detail: 'optional real-infrastructure end-to-end check' },
    { title: 'Document', detail: 'record as-built + lessons into the spec' },
    { title: 'Merge', detail: 'fast-forward base to the branch (local, no push); clean up worktree' },
  ],
}

// ---- inputs ----------------------------------------------------------------
// The runtime delivers `args` as a JSON STRING (or undefined) — parse defensively.
const A = (typeof args === 'string' && args.length)
  ? JSON.parse(args)
  : (args && typeof args === 'object' ? args : {})
const spec = A.spec
const repo = (A.repo || '').replace(/\/+$/, '')
if (!spec || !repo) {
  throw new Error('pnk-baton requires args.spec (path to spec/task) and args.repo (repository path)')
}
const base = A.base || 'main'
const dimensions = A.dimensions || ['correctness', 'security', 'performance/observability']
const validate = A.validate ?? false
const wantMerge = A.merge ?? true
const maxRetries = A.maxRetries ?? 2

// Remote target (optional). When set (e.g. "wiley@wiley-pinkleberry"), the repo,
// worktree, every source/test file, git, and the test command live on that host —
// NOT on this machine. Every stage reaches it over ssh. `repo`, `base`, `branch`,
// `spec`, and the worktree are all paths/refs ON the remote host.
const sshHost = (A.ssh || A.remote || '').trim() || null
const remoteNote = sshHost ? `

=== REMOTE TARGET — all work happens over SSH ===
The repository, your worktree, every source/test file, git, and the test command live on a REMOTE host, NOT this machine. Reach it with: \`ssh ${sshHost}\`. Every path below (repository, worktree, spec) is a path ON that host.
Hard rules:
- Run EVERY git, file, and test command on the remote by wrapping it: \`ssh ${sshHost} '<command>'\`. Quote the WHOLE command so pipes / && / redirects run remotely, not on this machine.
- The Read / Edit / Write / Grep / Glob tools act on THIS machine and CANNOT see the remote tree. Read a file with \`ssh ${sshHost} 'cat <path>'\` (or \`sed -n\`, \`grep\`). To create or replace a file, write it to a LOCAL temp first, then pipe it over: \`ssh ${sshHost} 'cat > <remote-path>' < /tmp/local\`. To edit in place, fetch → change locally → pipe back.
- The remote login shell may be fish: for ANY bash syntax (loops, \`$(...)\`, heredocs, \`[[ ]]\`) use \`ssh ${sshHost} bash -lc '<script>'\` or pipe a script: \`ssh ${sshHost} bash -s < /tmp/script.sh\`.
- Do your git work via \`ssh ${sshHost} git -C <path> ...\`. Keep the worktree, commits, and tests entirely on the remote — never copy the tree to this machine.
` : ''

// branch + per-run worktree path (no Date/random allowed in scripts; keep deterministic)
const specName = String(spec).split('/').pop().replace(/\.md$/, '').replace(/[^a-zA-Z0-9._-]/g, '-')
const branch = A.branch || `pnk-baton/${specName}`
const branchSlug = branch.replace(/\//g, '-')
const repoParent = repo.split('/').slice(0, -1).join('/') || '/'
// Worktree location is overridable (`A.worktree`) — e.g. to place it where a remote
// test container can see it (under the repo). Default: a sibling .pnk-baton-worktrees dir.
const workdir = (A.worktree || `${repoParent}/.pnk-baton-worktrees/${branchSlug}`).replace(/\/+$/, '')

// If the spec is a tracked file under the repo, its worktree copy is the one to document
// (so the doc commit lands with the branch); otherwise it's an external file edited in place.
const specRel = spec.startsWith(repo + '/') ? spec.slice(repo.length + 1) : null
const specInWorktree = specRel ? `${workdir}/${specRel}` : spec

// Build agents work IN the isolated worktree; merge/cleanup act on the original repo.
const fields = `Repository (your isolated worktree): ${workdir}\nBase branch: ${base}\nFeature branch: ${branch}\nSpec: ${spec}${remoteNote}`

// ---- schemas ---------------------------------------------------------------
const SETUP = {
  type: 'object', additionalProperties: false,
  properties: { status: { enum: ['READY', 'ERROR'] }, detail: { type: 'string' } },
  required: ['status'],
}
const PLAN = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    approach: { type: 'string' },
    successCriteria: { type: 'array', items: { type: 'string' } },
    validationNeeded: { type: 'boolean' },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'approach', 'successCriteria', 'validationNeeded'],
}
const TESTS = {
  type: 'object', additionalProperties: false,
  properties: {
    testFiles: { type: 'array', items: { type: 'string' } },
    runCommand: { type: 'string' },
    allFail: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['testFiles', 'runCommand', 'allFail'],
}
const BUILD = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    testsPass: { type: 'boolean' },
    flagged: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'testsPass'],
}
const VERDICT = {
  type: 'object', additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    status: { enum: ['PASS', 'REJECT'] },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          severity: { enum: ['Critical', 'High', 'Medium', 'Low', 'Optional'] },
          location: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'problem'],
      },
    },
  },
  required: ['dimension', 'status', 'findings'],
}
const VALID = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { enum: ['PASS', 'FAIL', 'SKIPPED'] },
    evidence: { type: 'string' },
    reproduction: { type: 'string' },
  },
  required: ['status', 'evidence'],
}
const INTEG = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { enum: ['CLEAN', 'CONFLICT'] },
    baseMoved: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    detail: { type: 'string' },
  },
  required: ['status', 'testsPass'],
}
const MERGE = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { enum: ['MERGED', 'NOT_FF', 'ERROR'] },
    baseCommit: { type: 'string' },
    detail: { type: 'string' },
  },
  required: ['status'],
}

// ---- Setup: isolated worktree ----------------------------------------------
phase('Setup')
const setup = await agent(
  `You are the pnk-baton SETUP step. Create an isolated git worktree so this run cannot collide with other concurrent pnk-baton runs.${remoteNote}\nOriginal repository: ${repo}\nBase branch: ${base}\nFeature branch: ${branch}\nWorktree path to create: ${workdir}\n\nSteps:\n1. If a worktree or directory already lingers at ${workdir} from a prior run, remove it first: \`git -C ${repo} worktree remove --force ${workdir}\` (ignore errors if absent), then \`rm -rf ${workdir}\` if the directory still exists, and \`git -C ${repo} worktree prune\`.\n2. Create the worktree on a fresh feature branch off ${base}: \`git -C ${repo} worktree add -B ${branch} ${workdir} ${base}\`.\n3. Verify \`git -C ${workdir} branch --show-current\` is ${branch} and the tree is clean.\nReport READY on success, or ERROR with the exact failure.`,
  { agentType: 'pnk-baton-integrator', phase: 'Setup', label: 'setup:worktree', schema: SETUP },
)
if (setup.status !== 'READY') {
  return { status: 'SETUP-FAILED', branch, base, worktree: workdir, reason: setup.detail || 'could not create worktree' }
}
log(`Setup: isolated worktree at ${workdir} on ${branch}`)

// ---- Plan ------------------------------------------------------------------
phase('Plan')
const plan = await agent(
  `You are the pnk-baton PLANNER.\n${fields}\n\nRead the spec, ground the design in the actual code, and produce a testable plan. Identify the smallest change that satisfies the requirement.`,
  { agentType: 'pnk-baton-planner', phase: 'Plan', schema: PLAN },
)
log(`Plan: ${plan.summary} (${plan.successCriteria.length} success criteria; validationNeeded=${plan.validationNeeded})`)

const wantValidate = validate || plan.validationNeeded

// ---- Test (red) ------------------------------------------------------------
phase('Test')
const tests = await agent(
  `You are the pnk-baton TEST-AUTHOR.\n${fields}\n\nYou are already on branch ${branch} in a dedicated worktree — do NOT create or switch branches. Write failing tests that encode these success criteria, then confirm they all fail for the right reason.\n\nSuccess criteria:\n${plan.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nPlan approach:\n${plan.approach}\n\nCommit the tests on ${branch} with a message: test: ${specName} (red).`,
  { agentType: 'pnk-baton-test-author', phase: 'Test', schema: TESTS },
)
log(`Tests: ${tests.testFiles.length} file(s); run with \`${tests.runCommand}\`; allFail=${tests.allFail}`)

// ---- Build + Integrate + Review loop ---------------------------------------
let priorFindings = ''
let confirmed = []
let shipped = false

for (let attempt = 0; attempt <= maxRetries; attempt++) {
  phase('Build')
  const build = await agent(
    `You are the pnk-baton BUILDER (the single writer).\n${fields}\n\nMake these tests pass with the minimum correct code. Run \`${tests.runCommand}\`. DO NOT modify any test file. Stay on ${branch} in this worktree. Commit on the feature branch: feat: ${specName}.\n\nPlan approach:\n${plan.approach}\n` +
      (priorFindings ? `\nThe reviewers REJECTED the previous attempt. Address every Critical/High finding below, then re-run the tests:\n${priorFindings}` : ''),
    { agentType: 'pnk-baton-builder', phase: 'Build', label: `build:attempt-${attempt + 1}`, schema: BUILD },
  )
  log(`Build attempt ${attempt + 1}: testsPass=${build.testsPass}${build.flagged?.length ? ` (flagged: ${build.flagged.join('; ')})` : ''}`)

  phase('Integrate')
  const integ = await agent(
    `You are the pnk-baton INTEGRATOR.\n${fields}\n\nIntegrate the latest ${base} into ${branch} (in this worktree) so the branch stays mergeable and the review diff is clean. Refresh ${base}, then \`git merge --no-ff ${base}\` into ${branch} (do NOT rebase). A large incoming changeset or many deletions coming from ${base} is EXPECTED — that is other people's work that has landed on ${base}, never something for you to undo or worry about. On a clean merge: re-run \`${tests.runCommand}\` and report CLEAN with testsPass. On conflict: \`git merge --abort\` and report CONFLICT with the conflicting paths; do NOT resolve it yourself.`,
    { agentType: 'pnk-baton-integrator', phase: 'Integrate', label: `integrate:attempt-${attempt + 1}`, schema: INTEG },
  )
  if (integ.status === 'CONFLICT') {
    return { status: 'CONFLICT-HALT', branch, base, worktree: workdir, reason: `Merging ${base} into ${branch} conflicts — operator must resolve`, detail: integ.detail, plan }
  }
  if (!integ.testsPass) {
    priorFindings = `Integrating ${base} into the branch broke the tests: ${integ.detail || '(see test run)'}. Make the tests pass on the integrated code (production code only; do not edit tests).`
    log(`Integrate attempt ${attempt + 1}: tests FAIL after integrating ${base} -> rebuild`)
    if (attempt === maxRetries) {
      return { status: 'BLOCKED', branch, base, worktree: workdir, reason: `tests fail after integrating ${base} after ${maxRetries + 1} attempts`, plan }
    }
    continue
  }
  log(`Integrate attempt ${attempt + 1}: CLEAN (baseMoved=${integ.baseMoved})`)

  phase('Review')
  const reviews = await parallel(
    dimensions.map((d, i) => () =>
      agent(
        `You are the pnk-baton REVIEWER. Your assigned DIMENSION is: ${d}.\n${fields}\n\nReview ONLY the changes this branch introduces — run \`git diff $(git merge-base ${base} HEAD)..HEAD\`. ${base} has just been integrated, so its history is an ancestor: incoming ${base} commits and deletions are NOT this branch's change and must never be reviewed or "fixed". Assume the branch's own changes contain bugs. ` +
          (i === 0
            ? `Additionally confirm the BUILDER did not modify any test file (git diff the test paths vs the test-author's commit) — if it did, REJECT. `
            : '') +
          `Flag only gaps that affect correctness or the stated requirements; mark anything else Optional.\n\nSuccess criteria:\n${plan.successCriteria.map((c, n) => `${n + 1}. ${c}`).join('\n')}`,
        { agentType: 'pnk-baton-reviewer', phase: 'Review', label: `review:${d}`, schema: VERDICT },
      ),
    ),
  )

  const good = reviews.filter(Boolean)
  const rejects = good.filter((r) => r.status === 'REJECT')
  confirmed = good.flatMap((r) => (r.findings || []).filter((f) => f.severity === 'Critical' || f.severity === 'High'))

  if (rejects.length === 0) {
    log(`Review PASS on all ${good.length} dimension(s) at attempt ${attempt + 1}`)
    shipped = true
    break
  }

  priorFindings = confirmed
    .map((f) => `- [${f.severity}] ${f.location || '?'}: ${f.problem}${f.fix ? ` -> fix: ${f.fix}` : ''}`)
    .join('\n')
  log(`Review REJECT (${rejects.map((r) => r.dimension).join(', ')}); ${confirmed.length} Critical/High finding(s). Retry ${attempt + 1}/${maxRetries}.`)

  if (attempt === maxRetries) {
    return { status: 'BLOCKED', branch, base, worktree: workdir, reason: `Reviewers still rejecting after ${maxRetries + 1} build attempts`, outstanding: confirmed, plan }
  }
}

// ---- Validate (optional) ---------------------------------------------------
let validation = null
if (shipped && wantValidate) {
  phase('Validate')
  validation = await agent(
    `You are the pnk-baton VALIDATOR (pre-merge pass).\n${fields}\n\nRun the feature end-to-end against real infrastructure on ${branch}. Judge output against the success criteria — wrong data with exit 0 is a FAIL. If the infrastructure is genuinely unavailable, report SKIPPED with the reason; do not fake a pass.\n\nSuccess criteria:\n${plan.successCriteria.map((c, n) => `${n + 1}. ${c}`).join('\n')}`,
    { agentType: 'pnk-baton-validator', phase: 'Validate', schema: VALID },
  )
  log(`Validation: ${validation.status}`)
}

// ---- Document: capture as-built + lessons into the spec (lands with merge) --
let documented = null
if (shipped) {
  phase('Document')
  documented = await agent(
    `You are the pnk-baton DOCUMENTER. The work is complete and reviewed. Update the spec to be an accurate as-built record.\n${fields}\n\nThe spec file to update is: ${specInWorktree}\n${specRel ? `This is the spec's copy INSIDE your worktree — edit it (NOT the original at ${spec}) so the documentation lands with the branch.` : `This spec is NOT tracked in this repo; update it in place and report SKIPPED (it can't ride the branch).`}\n\nAppend an "Implementation log / as-built" section: what actually changed (files + essence of \`git diff $(git merge-base ${base} HEAD)..HEAD\`), key decisions and any deviation from the plan, how each planner open question was resolved, lessons learned, and how to verify. Preserve the original spec; ADD the record. ${specRel ? `Commit on ${branch}: docs(spec): as-built ${specName} and report DOCUMENTED.` : ''}\n\nPlanner open questions to resolve:\n${(plan.openQuestions || []).map((q, n) => `${n + 1}. ${q}`).join('\n') || '(none)'}`,
    {
      agentType: 'pnk-baton-documenter',
      phase: 'Document',
      label: 'document',
      schema: {
        type: 'object', additionalProperties: false,
        properties: { status: { enum: ['DOCUMENTED', 'SKIPPED'] }, specPath: { type: 'string' }, summary: { type: 'string' } },
        required: ['status'],
      },
    },
  )
  log(`Document: ${documented.status}${documented.specPath ? ' -> ' + documented.specPath : ''}`)
}

// ---- Merge (default on; local fast-forward only, never push) ---------------
const validationOk = !validation || validation.status === 'PASS'
let merge = null
if (shipped && wantMerge && validationOk) {
  phase('Merge')
  merge = await agent(
    `You are performing the pnk-baton MERGE. All gates passed. Land ${branch} onto ${base} with a LOCAL fast-forward in the ORIGINAL repository, then clean up the per-run worktree. Do NOT push to any remote.${remoteNote}\nOriginal repository: ${repo}\nBase branch: ${base}\nFeature branch: ${branch}\nPer-run worktree: ${workdir}\n\n1. In ${repo}, confirm ${base} is an ancestor of ${branch}: \`git -C ${repo} merge-base --is-ancestor ${base} ${branch}\`.\n2. If YES, fast-forward base to the branch tip:\n   - if ${base} is the checked-out branch of ${repo}: \`git -C ${repo} merge --ff-only ${branch}\`;\n   - if ${base} is checked out in another worktree: \`git -C ${repo} update-ref refs/heads/${base} ${branch}\`.\n   Report MERGED with the new ${base} commit sha.\n3. If ${base} is NOT an ancestor (it moved): do NOT force, report NOT_FF and stop.\n4. On MERGED only, remove the per-run worktree: \`git -C ${repo} worktree remove --force ${workdir} && git -C ${repo} worktree prune\`.\nNever push. Never --force a merge. Never rebase. Never modify code or tests.`,
    { agentType: 'pnk-baton-merger', phase: 'Merge', label: 'merge', schema: MERGE },
  )
  log(`Merge: ${merge.status}${merge.baseCommit ? ' @ ' + merge.baseCommit : ''}`)
}

// ---- Report ----------------------------------------------------------------
const merged = merge && merge.status === 'MERGED'
return {
  status: validation && validation.status === 'FAIL' ? 'VALIDATION-FAILED'
    : merged ? 'MERGED'
    : 'READY',
  branch,
  base,
  worktree: merged ? '(removed after merge)' : workdir,
  plan,
  tests: { files: tests.testFiles, run: tests.runCommand },
  review: 'PASS (all dimensions)',
  integrated: base,
  documented: documented ? documented.status : 'skipped',
  validation: validation ? validation.status : (wantValidate ? 'unavailable' : 'not-requested'),
  merge: merge ? merge.status : (!wantMerge ? 'disabled' : (!validationOk ? 'skipped (validation not PASS)' : 'skipped')),
  mergedCommit: merged ? merge.baseCommit : undefined,
  note: merged
    ? `Merged ${branch} into ${base} locally (${merge.baseCommit}); worktree cleaned up. Push when ready: git push origin ${base}.`
    : (merge && merge.status === 'NOT_FF')
      ? `${base} moved; not fast-forwardable. Re-run pnk-baton (it will re-integrate) or integrate+merge manually from worktree ${workdir}.`
      : `Branch ${branch} is built, tested, and reviewed in worktree ${workdir}. Merge: git -C ${repo} merge ${branch}.`,
}
