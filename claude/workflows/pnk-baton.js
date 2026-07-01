export const meta = {
  name: 'pnk-baton',
  description: 'Multi-agent build/review pipeline in an isolated worktree: plan -> test-first -> build -> integrate -> adversarial review (parallel dimensions) -> optional validate -> auto-merge. Single writer; author != reviewer.',
  whenToUse: 'A non-trivial build, fix, or refactor you want run through plan/test/build/review gates with context kept out of the main session. Safe to run several at once — each gets its own worktree.',
  phases: [
    { title: 'Setup', detail: 'create an isolated per-run git worktree' },
    { title: 'Plan', detail: 'planner turns the spec into a testable design' },
    { title: 'Align', detail: 'drift-checker: pre-build alignment vs North Star / principles / spec / roadmap' },
    { title: 'Test', detail: 'test-author writes failing tests (red) + reconciles tests obsoleted by the change' },
    { title: 'Baseline', detail: 'capture pre-existing failures on base so the gate judges NEW failures only' },
    { title: 'Build', detail: 'builder makes tests pass (green); loops with review' },
    { title: 'Integrate', detail: 'merge latest base into the branch' },
    { title: 'Review', detail: 'independent reviewers, one per dimension, in parallel' },
    { title: 'Accept', detail: 'drift-checker: post-build UAT of the diff vs roadmap / North Star' },
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

// Target environment — REQUIRED, no default (every run must declare staging|prod).
// Drives: which infra the validator/builder exercise, whether validation is mandatory
// (prod => always, and must PASS to ship), and a signal the drift-checker enforces
// (a prod target with no staging precedent is drift).
const env = String(A.env || A.environment || '').trim().toLowerCase()
if (env !== 'staging' && env !== 'prod') {
  throw new Error("pnk-baton requires args.env = 'staging' or 'prod' (no default — every run must declare its target environment)")
}
const isProd = env === 'prod'
const envNote = `\n\n=== TARGET ENVIRONMENT: ${env.toUpperCase()} ===\nThis run targets the ${env} environment. Exercise EVERY infrastructure- or data-touching test and validation against the ${env} target. NEVER read or mutate production data/infrastructure unless the target is explicitly prod.${isProd ? '\nThis is a PRODUCTION-targeted run: real-infrastructure validation is MANDATORY (it cannot be skipped or SKIPPED-away), and a change reaching prod with no prior staging pass is DRIFT — confirm a staging precedent exists before accepting.' : ''}`

// Merge target depends on env: a staging run lands on the STAGING integration branch
// (default 'staging', override via A.stagingBranch) with a --no-ff merge commit — NEVER on
// main. A prod run lands on `base` (main) with the legacy fast-forward. This keeps the
// staging-first flow automatic: validated work accumulates on `staging`, and only a
// deliberate prod run (or manual promotion) advances main.
const stagingBranch = String(A.stagingBranch || 'staging').trim()
const mergeTarget = isProd ? base : stagingBranch

// Drift / alignment gate inputs. `requireRoadmap` makes a missing roadmap a hard halt
// (default: warn-and-continue). `northStar` / `roadmap` are optional path overrides; when
// absent the drift-checker auto-discovers them by convention.
const requireRoadmap = A.requireRoadmap ?? false
const northStarPath = (A.northStar || '').trim() || null
const roadmapPath = (A.roadmap || '').trim() || null
const driftNote = `Artifact locations:\n- North Star: ${northStarPath ? `use ${northStarPath}` : 'auto-discover (NORTH-STAR.md / VISION.md / a North Star section in AGENTS.md/CLAUDE.md/README)'}\n- Roadmap: ${roadmapPath ? `use ${roadmapPath}` : 'auto-discover (ROADMAP.md / backlog index / epics doc / spec frontmatter roadmap|epic field)'}\n- Always read the repo AGENTS.md/CLAUDE.md for the project's "how we do things" principles.\nRoadmap policy this run: ${requireRoadmap ? 'REQUIRED — a missing roadmap is a hard failure.' : 'a missing roadmap is reported but not blocking.'}`

// Remote target (optional). When set (e.g. "user@host"), the repo,
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
const fields = `Repository (your isolated worktree): ${workdir}\nBase branch: ${base}\nFeature branch: ${branch}\nSpec: ${spec}\nTarget environment: ${env.toUpperCase()}${remoteNote}`

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
const BASELINE = {
  type: 'object', additionalProperties: false,
  properties: {
    failures: { type: 'array', items: { type: 'string' } },
    ran: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['failures', 'ran'],
}
const BUILD = {
  type: 'object', additionalProperties: false,
  properties: {
    testsPass: { type: 'boolean' },
    summary: { type: 'string' },
    flagged: { type: 'array', items: { type: 'string' } },
  },
  required: ['testsPass', 'summary'],
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
const DRIFT = {
  type: 'object', additionalProperties: false,
  properties: {
    mode: { enum: ['pre-build', 'post-build'] },
    status: { enum: ['ALIGNED', 'DRIFT', 'ROADMAP-MISSING'] },
    northStarFound: { type: 'boolean' },
    roadmapFound: { type: 'boolean' },
    artifacts: {
      type: 'object', additionalProperties: false,
      properties: {
        northStar: { type: ['string', 'null'] },
        roadmap: { type: ['string', 'null'] },
        principles: { type: ['string', 'null'] },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          severity: { enum: ['Critical', 'High', 'Medium', 'Low', 'Optional'] },
          axis: { enum: ['project-north-star', 'baton-principles', 'how-we-do-things', 'spec', 'roadmap'] },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          recommendation: { type: 'string' },
        },
        required: ['severity', 'axis', 'problem', 'evidence'],
      },
    },
    roadmapAlignment: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['mode', 'status', 'roadmapFound', 'findings', 'summary'],
}
const INTEG = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { enum: ['CLEAN', 'CONFLICT'] },
    testsPass: { type: 'boolean' },
    baseMoved: { type: 'boolean' },
    newFailures: { type: 'array', items: { type: 'string' } },
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
  `You are the pnk-baton SETUP step. Create an isolated git worktree so this run cannot collide with other concurrent pnk-baton runs.${remoteNote}\nOriginal repository: ${repo}\nBase branch: ${base}\nFeature branch: ${branch}\nWorktree path to create: ${workdir}\n\nSteps:\n0. PRESERVE COMPLETED WORK — NEVER wipe a build. If branch ${branch} already exists, check \`git -C ${repo} rev-list --count ${base}..${branch}\`. If that count is > 0, the branch holds UNMERGED completed work from a prior run: do NOT remove the worktree, do NOT delete or force-reset the branch. Report ERROR with detail "lingering unmerged work on ${branch} (N commits ahead of ${base}); reuse/salvage it — do NOT rebuild from scratch" and STOP. (The caller will resume or merge that branch instead of starting over.)\n1. Only when ${branch} does NOT exist, or has ZERO commits ahead of ${base} (nothing to lose): clear any stale worktree at ${workdir} — \`git -C ${repo} worktree remove --force ${workdir}\` (ignore errors if absent), \`rm -rf ${workdir}\` if the directory remains, \`git -C ${repo} worktree prune\`.\n2. Create the worktree: if ${branch} exists (and step 0 allowed continuing), reuse it — \`git -C ${repo} worktree add ${workdir} ${branch}\`; otherwise create it fresh off ${base} — \`git -C ${repo} worktree add -B ${branch} ${workdir} ${base}\`. Never \`-B\` over an existing branch that has commits.\n3. Verify \`git -C ${workdir} branch --show-current\` is ${branch}.\nReport READY on success, or ERROR with the exact failure.`,
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
log(`Target environment: ${env.toUpperCase()}${isProd ? ' — production: real-infra validation MANDATORY and must PASS to ship' : ''}`)

// Prod targets ALWAYS validate (and must PASS — see validationOk below); staging keeps
// the validator optional (run if requested or the planner deems it needed).
const wantValidate = isProd || validate || plan.validationNeeded

// Format a drift verdict's findings for logs / feedback / the final report.
const fmtDrift = (d) => (d.findings || [])
  .map((f) => `- [${f.severity}/${f.axis}] ${f.problem}${f.evidence ? ` (${f.evidence})` : ''}${f.recommendation ? ` -> ${f.recommendation}` : ''}`)
  .join('\n')

// Threshold is enforced in CODE, not just the prompt: Critical/High/Medium block, and a
// blocking-severity finding must carry concrete cited evidence (else it's vibes — ignore it).
// A verdict drifts if the agent said DRIFT, OR any evidence-backed blocking finding exists.
const blockingFindings = (d) => (d.findings || []).filter(
  (f) => (f.severity === 'Critical' || f.severity === 'High' || f.severity === 'Medium') && f.evidence && String(f.evidence).trim(),
)
const isDrift = (d) => d.status === 'DRIFT' || blockingFindings(d).length > 0

// ---- Align: pre-build drift gate (cheap; catch drift before any code) -------
phase('Align')
const align = await agent(
  `You are the pnk-baton DRIFT-CHECKER in **pre-build** mode. No code exists yet — judge the SPEC and the PLANNER's design for alignment before any build tokens are spent.\n${fields}\n\n${driftNote}${envNote}\n\nPlanner summary: ${plan.summary}\nPlanner approach:\n${plan.approach}\nSuccess criteria:\n${plan.successCriteria.map((c, n) => `${n + 1}. ${c}`).join('\n')}\n\nAudit alignment across project-north-star, baton-principles, how-we-do-things, spec, and roadmap. Locate the North Star and roadmap (report exactly what you found). Judge neutrally. DRIFT on genuine Critical/High/MEDIUM misalignment (scope creep, direction change, rule violation, off-roadmap work, any silent data loss / destructive action / skipped-staging risk) — but every blocking finding MUST cite concrete evidence (file/section + quoted intent) or be downgraded to Optional. ROADMAP-MISSING only when the absence of a roadmap is the sole blocking issue; otherwise ALIGNED. Do not over-block a correct, minimal, on-roadmap plan, and do not rubber-stamp drift.`,
  { agentType: 'pnk-baton-drift-checker', phase: 'Align', label: 'align:pre-build', schema: DRIFT },
)
log(`Align: ${align.status} (northStar=${align.northStarFound}, roadmap=${align.roadmapFound}); ${blockingFindings(align).length} blocking / ${(align.findings || []).length} total finding(s)`)

if (isDrift(align)) {
  return { status: 'DRIFT-HALT', branch, base, worktree: workdir, when: 'pre-build', reason: 'Pre-build alignment drift — operator must reconcile scope/direction before building.', findings: fmtDrift(align), drift: align, plan }
} else if (align.status === 'ROADMAP-MISSING') {
  if (requireRoadmap) {
    return { status: 'ROADMAP-MISSING', branch, base, worktree: workdir, when: 'pre-build', reason: 'No roadmap found and --require-roadmap is set. Create or point to a canonical roadmap, then re-run.', drift: align, plan }
  }
  log('Align: no roadmap found — WARNING (not blocking; pass --require-roadmap to enforce). Continuing.')
}

// ---- Test (red) ------------------------------------------------------------
phase('Test')
const tests = await agent(
  `You are the pnk-baton TEST-AUTHOR.\n${fields}\n\nYou are already on branch ${branch} in a dedicated worktree — do NOT create or switch branches. Write failing tests that encode these success criteria, then confirm they all fail for the right reason.\n\nRECONCILE OBSOLETE TESTS (part of the red phase — you are the ONLY stage allowed to touch test files): if this change REMOVES or REPLACES existing behavior, pre-existing tests that assert the now-removed contract will fail once the builder lands the change, and the builder is FORBIDDEN to fix them — so YOU must delete or repoint them in this same commit. Read the spec/plan for anything it deletes or replaces (a response field, a payload shape, a helper, a whole surface), grep the test suite for tests asserting that removed contract, and delete or rewrite them to the new contract now. If the spec names specific test files to delete/repoint, do exactly that. Only reconcile tests made obsolete by THIS change — never weaken or delete unrelated tests to force green.\n\nSuccess criteria:\n${plan.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nPlan approach:\n${plan.approach}\n\nCommit the tests on ${branch} with a message: test: ${specName} (red).`,
  { agentType: 'pnk-baton-test-author', phase: 'Test', schema: TESTS },
)
log(`Tests: ${tests.testFiles.length} file(s); run with \`${tests.runCommand}\`; allFail=${tests.allFail}`)

// ---- Baseline: pre-existing failures on `base` (so the gate judges NEW failures only) --------
// A test that ALREADY fails on `base` is unrelated debt — not this branch's fault. Without this
// baseline the Build<->Integrate loop false-fails (and eventually false-BLOCKS) whenever `base`
// carries any red test: the integrator re-runs the whole suite, sees the pre-existing red, reports
// testsPass=false, and the builder — correctly refusing to touch non-epic code — can never converge.
// Placed once here (the baseline doesn't change across build attempts). Falls back to absolute
// gating if it genuinely can't run against `base`.
const workdirParent = workdir.split('/').slice(0, -1).join('/') || '/'
const baselineWorktree = `${workdirParent}/pnk-baseline-${branchSlug}`
phase('Baseline')
const baseline = await agent(
  `You are the pnk-baton INTEGRATOR establishing a TEST BASELINE on ${base}. Capture which tests ALREADY FAIL on a clean ${base} — pre-existing debt this branch is NOT responsible for and must never be blamed for.\n${fields}\n\nSteps:\n1. Remove any stale baseline worktree, then create a fresh worktree of ${base} where the test harness can see it — use the SAME parent directory as the feature worktree (${workdirParent}) so a test container that mounts the repo also mounts it: \`git -C ${repo} worktree remove --force ${baselineWorktree}\` (ignore errors), \`git -C ${repo} worktree prune\`, \`git -C ${repo} worktree add ${baselineWorktree} ${base}\`.\n2. In ${baselineWorktree}, run the SAME gate the branch uses — \`${tests.runCommand}\` — with the SAME environment/setup (run it byte-for-byte identically so env-driven failures are captured in the baseline too). The branch's NEW test files do not exist on ${base}, so everything that fails here is pre-existing debt.\n3. Collect the exact FAILING test identifiers (pytest node ids \`path::Class::test\`, vitest test names, or the tool's equivalent — enough to match them against the branch run). Report them in \`failures\` and set ran=true.\n4. Clean up: \`git -C ${repo} worktree remove --force ${baselineWorktree} && git -C ${repo} worktree prune\`.\nIf the gate genuinely cannot run against ${base} (infra down, command errors before collecting), report ran=false with an empty failures list and the reason in note — the run will fall back to absolute gating.`,
  { agentType: 'pnk-baton-integrator', phase: 'Baseline', label: 'baseline:base-failures', schema: BASELINE },
)
const baselineFailures = (baseline.failures || []).filter(Boolean)
log(`Baseline: ${baseline.ran ? `${baselineFailures.length} pre-existing failure(s) on ${base}` : `could not run on ${base} — absolute gating`}${baseline.note ? ` (${baseline.note})` : ''}`)
const baselineNote = baselineFailures.length
  ? `\n\n=== PRE-EXISTING TEST FAILURES ON ${base} (baseline) ===\nThese tests ALREADY FAIL on ${base} — pre-existing debt, NOT this branch's responsibility. Do NOT try to fix them, do NOT edit them, and they MUST NOT count as a failure or trigger a rebuild. A test counts as failing for THIS branch ONLY if it is NOT in this list (i.e. a NEW failure the branch introduced):\n${baselineFailures.map((f) => `- ${f}`).join('\n')}`
  : (baseline.ran
      ? `\n\n(Baseline: ${base} is fully green — treat any failing test as this branch's own.)`
      : `\n\n(Baseline: could not be measured on ${base} — using absolute gating; treat any failing test as this branch's own.)`)

// ---- Build + Integrate + Review loop ---------------------------------------
let priorFindings = ''
let confirmed = []
let shipped = false

for (let attempt = 0; attempt <= maxRetries; attempt++) {
  phase('Build')
  const build = await agent(
    `You are the pnk-baton BUILDER (the single writer).\n${fields}\n\nMake these tests pass with the minimum correct code. Run \`${tests.runCommand}\`. DO NOT modify any test file. Stay on ${branch} in this worktree. Commit on the feature branch: feat: ${specName}.${baselineNote}\n\nReport testsPass=true when your target tests pass AND the branch introduces NO NEW failures vs the baseline above — a test that also fails on ${base} (in the baseline list) is pre-existing debt, is NOT yours to fix, and does NOT keep testsPass from being true. Never edit a test to silence it. If your only remaining failures are pre-existing baseline ones, report testsPass=true and list them in \`flagged\` as pre-existing.\n\n**Final report:** your StructuredOutput MUST set \`testsPass\` (boolean) FIRST, then a \`summary\` of AT MOST 3 sentences — do not write a long essay, the committed diff is the record.\n\nPlan approach:\n${plan.approach}\n` +
      (priorFindings ? `\nThe reviewers REJECTED the previous attempt. Address every Critical, High, and Medium finding below, then re-run the tests:\n${priorFindings}` : ''),
    { agentType: 'pnk-baton-builder', phase: 'Build', label: `build:attempt-${attempt + 1}`, schema: BUILD },
  )
  log(`Build attempt ${attempt + 1}: testsPass=${build.testsPass}${build.flagged?.length ? ` (flagged: ${build.flagged.join('; ')})` : ''}`)

  phase('Integrate')
  const integ = await agent(
    `You are the pnk-baton INTEGRATOR.\n${fields}\n\nIntegrate the latest ${base} into ${branch} (in this worktree) so the branch stays mergeable and the review diff is clean. Refresh ${base}, then \`git merge --no-ff ${base}\` into ${branch} (do NOT rebase). A large incoming changeset or many deletions coming from ${base} is EXPECTED — that is other people's work that has landed on ${base}, never something for you to undo or worry about. On a clean merge: re-run \`${tests.runCommand}\`. On conflict: \`git merge --abort\` and report CONFLICT with the conflicting paths; do NOT resolve it yourself.${baselineNote}\n\ntestsPass means NO NEW failures vs ${base}, NOT an all-green suite: after re-running, compute newFailures = (tests failing now) MINUS (the baseline list above), matching by test identifier. Report testsPass=true iff newFailures is empty. Pre-existing baseline failures do NOT count and must NEVER trigger a rebuild (the builder cannot fix non-branch code — looping on base debt is the bug this guards against). Put any NEW failures in \`newFailures\` and \`detail\`; if there are none, report CLEAN + testsPass=true even when the raw suite still shows baseline reds.`,
    { agentType: 'pnk-baton-integrator', phase: 'Integrate', label: `integrate:attempt-${attempt + 1}`, schema: INTEG },
  )
  if (integ.status === 'CONFLICT') {
    return { status: 'CONFLICT-HALT', branch, base, worktree: workdir, reason: `Merging ${base} into ${branch} conflicts — operator must resolve`, detail: integ.detail, plan }
  }
  if (!integ.testsPass) {
    const newFails = (integ.newFailures || []).filter(Boolean)
    const newFailList = newFails.length ? `\nNEW failures the branch introduced (baseline debt already excluded):\n${newFails.map((f) => `- ${f}`).join('\n')}` : ''
    priorFindings = `Integrating ${base} introduced NEW test failures (pre-existing ${base} debt already excluded — do NOT touch those). Fix them with production code only (do not edit tests).${newFailList}${integ.detail ? `\n${integ.detail}` : ''}`
    log(`Integrate attempt ${attempt + 1}: ${newFails.length || 'some'} NEW failure(s) vs ${base} -> rebuild`)
    if (attempt === maxRetries) {
      return { status: 'BLOCKED', branch, base, worktree: workdir, reason: `Branch still introduces NEW test failures vs ${base} after ${maxRetries + 1} attempts (pre-existing baseline debt excluded)${newFails.length ? `: ${newFails.join(', ')}` : ''}. If these are TEST files asserting behavior this change removed, the test-author must reconcile them (the builder cannot edit tests) — re-run after the spec names them.`, newFailures: newFails, plan }
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
  confirmed = good.flatMap((r) => (r.findings || []).filter((f) => f.severity === 'Critical' || f.severity === 'High' || f.severity === 'Medium'))

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

// ---- Accept: post-build drift gate (UAT the finished diff before shipping) --
let accept = null
if (shipped) {
  phase('Accept')
  accept = await agent(
    `You are the pnk-baton DRIFT-CHECKER in **post-build** mode. The work is built, tested, and the adversarial reviewers PASSED. Perform user-acceptance-style alignment validation on the ACTUAL diff before it ships.\n${fields}\n\n${driftNote}${envNote}\n\nRead the branch's own change: \`git -C ${workdir} diff $(git -C ${workdir} merge-base ${base} HEAD)..HEAD\`. ${base} is integrated, so incoming ${base} commits/deletions are NOT this branch's change — never judge them.\n\nSpec being implemented: ${spec}\nPlanner summary: ${plan.summary}\nSuccess criteria:\n${plan.successCriteria.map((c, n) => `${n + 1}. ${c}`).join('\n')}\n\nConfirm the SHIPPED work still aligns: did it drift from the plan/spec during build? Does the completed change actually deliver a roadmap item (acceptance), or solve something adjacent? Did it silently lose data, take a destructive/irreversible action, or skip staging? Honor project-north-star, baton-principles, how-we-do-things, spec, roadmap. Judge neutrally. DRIFT on genuine Critical/High/MEDIUM misalignment, every blocking finding citing concrete evidence (or downgrade to Optional); ROADMAP-MISSING only when a missing roadmap is the sole blocking issue; otherwise ALIGNED. Do not over-block correct, minimal, on-roadmap work, and do not rubber-stamp drift.`,
    { agentType: 'pnk-baton-drift-checker', phase: 'Accept', label: 'accept:post-build', schema: DRIFT },
  )
  log(`Accept: ${accept.status} (roadmap=${accept.roadmapFound}); ${blockingFindings(accept).length} blocking / ${(accept.findings || []).length} total finding(s)`)

  if (isDrift(accept)) {
    return { status: 'DRIFT-BLOCKED', branch, base, worktree: workdir, when: 'post-build', reason: 'Post-build acceptance drift — the shipped work diverges from spec/roadmap/North Star. Not merged; branch left for operator.', findings: fmtDrift(accept), drift: accept, plan }
  } else if (accept.status === 'ROADMAP-MISSING') {
    if (requireRoadmap) {
      return { status: 'ROADMAP-MISSING', branch, base, worktree: workdir, when: 'post-build', reason: 'No roadmap found and --require-roadmap is set. Branch is built+reviewed but not merged; add a roadmap and re-run (it will re-integrate).', drift: accept, plan }
    }
    log('Accept: no roadmap found — WARNING (not blocking). Continuing to ship.')
  }
}

// ---- Validate (optional) ---------------------------------------------------
let validation = null
if (shipped && wantValidate) {
  phase('Validate')
  validation = await agent(
    `You are the pnk-baton VALIDATOR (pre-merge pass).\n${fields}${envNote}\n\nRun the feature end-to-end against the ${env} infrastructure on ${branch}. Judge output against the success criteria — wrong data with exit 0 is a FAIL.${isProd ? ' This is a PRODUCTION-targeted run: validation is MANDATORY — SKIPPED is NOT acceptable (a SKIP blocks the ship). Only PASS clears it.' : ' If the infrastructure is genuinely unavailable, report SKIPPED with the reason; do not fake a pass.'}\n\nSuccess criteria:\n${plan.successCriteria.map((c, n) => `${n + 1}. ${c}`).join('\n')}`,
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
// Staging: OK to ship unless validation explicitly FAILed (SKIPPED/absent is tolerated).
// Prod: validation is MANDATORY and must be PASS — a SKIPPED/absent validation blocks the ship.
const prodValidationMissing = isProd && !(validation && validation.status === 'PASS')
const validationOk = isProd
  ? (validation && validation.status === 'PASS')
  : (!validation || validation.status === 'PASS')
let merge = null
if (shipped && wantMerge && validationOk) {
  phase('Merge')
  const mergePrompt = isProd
    ? `You are performing the pnk-baton MERGE (PROD target). All gates passed. Land ${branch} onto ${base} with a LOCAL fast-forward in the ORIGINAL repository, then clean up the per-run worktree. Do NOT push to any remote.${remoteNote}\nOriginal repository: ${repo}\nBase branch: ${base}\nFeature branch: ${branch}\nPer-run worktree: ${workdir}\n\n1. In ${repo}, confirm ${base} is an ancestor of ${branch}: \`git -C ${repo} merge-base --is-ancestor ${base} ${branch}\`.\n2. If YES, fast-forward base to the branch tip:\n   - if ${base} is the checked-out branch of ${repo}: \`git -C ${repo} merge --ff-only ${branch}\`;\n   - if ${base} is checked out in another worktree: \`git -C ${repo} update-ref refs/heads/${base} ${branch}\`.\n   Report MERGED with the new ${base} commit sha.\n3. If ${base} is NOT an ancestor (it moved): do NOT force, report NOT_FF and stop.\n4. On MERGED only, remove the per-run worktree: \`git -C ${repo} worktree remove --force ${workdir} && git -C ${repo} worktree prune\`.\nNever push. Never --force a merge. Never rebase. Never modify code or tests.`
    : `You are performing the pnk-baton STAGING MERGE. All gates passed and this is an --env staging run, so land ${branch} on the STAGING integration branch '${stagingBranch}' — NOT on ${base}/main. Do NOT push to any remote, and NEVER touch ${base}/main.${remoteNote}\nOriginal repository: ${repo}\nFeature branch: ${branch}\nStaging branch: ${stagingBranch}\nPer-run feature worktree: ${workdir}\n\n1. Ensure the staging branch exists: if \`git -C ${repo} show-ref --verify --quiet refs/heads/${stagingBranch}\` fails, create it off ${base}: \`git -C ${repo} branch ${stagingBranch} ${base}\`.\n2. A --no-ff merge needs a working tree. Find an existing worktree for ${stagingBranch} in \`git -C ${repo} worktree list\` and use it; otherwise add a temporary one: \`git -C ${repo} worktree add /tmp/pnk-staging-merge ${stagingBranch}\` (reuse if it already exists).\n3. In that staging worktree, merge the feature with an explicit merge commit: \`git -C <staging-worktree> merge --no-ff ${branch} -m "merge: ${branch} into ${stagingBranch} (staging-validated, env=staging)"\`. If it CONFLICTS: \`git -C <staging-worktree> merge --abort\` and report NOT_FF with the conflicting paths in detail; do NOT resolve.\n4. On a clean merge report MERGED with the new ${stagingBranch} commit sha (as baseCommit).\n5. On MERGED only, remove the per-run FEATURE worktree: \`git -C ${repo} worktree remove --force ${workdir} && git -C ${repo} worktree prune\`. LEAVE the ${stagingBranch} branch and its worktree in place.\nNever push. Never --force a merge. Never rebase. Never modify code or tests. Never advance ${base}/main.`
  merge = await agent(
    mergePrompt,
    { agentType: 'pnk-baton-merger', phase: 'Merge', label: 'merge', schema: MERGE },
  )
  log(`Merge: ${merge.status}${merge.baseCommit ? ` -> ${mergeTarget} @ ${merge.baseCommit}` : ''}`)
}

// ---- Report ----------------------------------------------------------------
const merged = merge && merge.status === 'MERGED'
return {
  status: (validation && validation.status === 'FAIL') || prodValidationMissing ? 'VALIDATION-FAILED'
    : merged ? 'MERGED'
    : 'READY',
  branch,
  base,
  environment: env,
  mergeTarget,
  worktree: merged ? '(removed after merge)' : workdir,
  plan,
  tests: { files: tests.testFiles, run: tests.runCommand },
  review: 'PASS (all dimensions)',
  alignment: {
    preBuild: align ? align.status : 'skipped',
    postBuild: accept ? accept.status : 'skipped',
    roadmapFound: accept ? accept.roadmapFound : align.roadmapFound,
    roadmap: (accept || align).artifacts ? (accept || align).artifacts.roadmap : null,
  },
  integrated: base,
  documented: documented ? documented.status : 'skipped',
  validation: validation ? validation.status : (wantValidate ? 'unavailable' : 'not-requested'),
  merge: merge ? merge.status : (!wantMerge ? 'disabled' : (!validationOk ? 'skipped (validation not PASS)' : 'skipped')),
  mergedCommit: merged ? merge.baseCommit : undefined,
  note: merged
    ? (isProd
        ? `Merged ${branch} into ${base} (main) locally (${merge.baseCommit}); worktree cleaned up. Push when ready: git push origin ${base}.`
        : `Merged ${branch} into the STAGING branch '${stagingBranch}' locally (${merge.baseCommit}); main NOT touched, feature worktree cleaned up. Push when ready: git push origin ${stagingBranch}. Promote to main in a separate deliberate step.`)
    : (merge && merge.status === 'NOT_FF')
      ? (isProd
          ? `${base} moved; not fast-forwardable. Re-run pnk-baton (it will re-integrate) or integrate+merge manually from worktree ${workdir}.`
          : `Staging merge into '${stagingBranch}' conflicted; aborted. Branch left intact at ${workdir} — reconcile '${stagingBranch}' manually.`)
      : prodValidationMissing
        ? `PROD target: real-infrastructure validation did not PASS (status: ${validation ? validation.status : 'unavailable'}). A prod-targeted change must pass validation before it can ship — not merged; branch left intact at ${workdir}. Re-run after validation passes.`
        : `Branch ${branch} is built, tested, and reviewed (${env}) in worktree ${workdir}. Merge target would be ${mergeTarget}: git -C ${repo} merge ${branch}.`,
}
