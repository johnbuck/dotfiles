// Control-flow regression suite for the pnk-baton workflow.
//
// Executes the REAL pnk-baton.js against a stubbed agent runtime — no network, no git,
// no subagents — and asserts the triage / repair / stop-loss paths behave as designed,
// including that the ordinary happy path and the pre-existing BLOCKED path still work.
//
//   node claude/tests/pnk-baton-flow.test.mjs          # test the repo copy
//   node claude/tests/pnk-baton-flow.test.mjs <path>   # test an installed copy
//
// Exit 0 = all paths hold. Run it after ANY edit to the workflow script.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Defaults to this repo's own copy; pass a path to test an installed one instead:
//   node claude/tests/pnk-baton-flow.test.mjs ~/.claude/workflows/pnk-baton.js
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TARGET = process.argv[2] || path.join(HERE, '..', 'workflows', 'pnk-baton.js')

const raw = fs.readFileSync(TARGET, 'utf8')
  .replace('export const meta', 'const meta')
const factory = new Function('args', 'agent', 'parallel', 'phase', 'log',
  `return (async () => {\n${raw}\n})()`)

const PLAN = { summary: 's', goal: 'g', approach: 'a', successCriteria: ['c1'], validationNeeded: false, openQuestions: [] }
const ALIGNED = { mode: 'pre-build', status: 'ALIGNED', roadmapFound: true, findings: [], summary: 'ok', specRubric: [] }
const TESTS = { testFiles: ['t.py'], runCommand: 'pytest', allFail: true }

function makeRuntime(script) {
  const calls = []
  const agent = async (prompt, opts) => {
    const label = opts.label || opts.phase
    calls.push(label)
    const key = Object.keys(script).find((k) => label.startsWith(k))
    if (!key) throw new Error(`no stub for label: ${label}`)
    const v = script[key]
    return typeof v === 'function' ? v(calls) : v
  }
  return {
    calls,
    agent,
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    phase: () => {},
    log: () => {},
  }
}

const BASE = {
  'setup': { status: 'READY' },
  'Plan': PLAN,
  'align': ALIGNED,
  'Test': TESTS,
  'baseline': { ran: true, failures: [] },
  'integrate': { status: 'CLEAN', testsPass: true, baseMoved: false },
  'review': { dimension: 'd', status: 'PASS', findings: [] },
  'accept': { mode: 'post-build', status: 'ALIGNED', roadmapFound: true, findings: [], summary: 'ok' },
  'document': { status: 'DOCUMENTED' },
  'merge': { status: 'MERGED', baseCommit: 'abc1234' },
}

const ARGS = JSON.stringify({ spec: '/r/backlog/s.md', repo: '/r', env: 'staging', merge: true })

let pass = 0, fail = 0
async function scenario(name, script, assertFn, args = ARGS) {
  const rt = makeRuntime({ ...BASE, ...script })
  let out
  try {
    out = await factory(args, rt.agent, rt.parallel, rt.phase, rt.log)
  } catch (e) {
    console.log(`FAIL  ${name}: threw ${e.message}`); fail++; return
  }
  try {
    assertFn(out, rt.calls)
    console.log(`pass  ${name}  -> ${out.status}`); pass++
  } catch (e) {
    console.log(`FAIL  ${name}: ${e.message}\n      status=${out.status} reason=${(out.reason || '').slice(0, 120)}\n      calls=${rt.calls.join(' ')}`)
    fail++
  }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`) }
const ok = (c, m) => { if (!c) throw new Error(m) }

// 1. defect filed -> adjudicator REPAIRS -> next build green -> ships
await scenario('defect -> REPAIRED -> ships', {
  'build': (calls) => calls.filter((c) => c.startsWith('build')).length === 1
    ? { testsPass: false, summary: 'x', failingTests: ['t::a'], defect: { file: 't.py', problem: 'pinned to prod', evidence: 'expected 12 got 1' } }
    : { testsPass: true, summary: 'ok' },
  'repair': { verdict: 'REPAIRED', rationale: 'pin was prod-derived', filesChanged: ['t.py'], contractPreserved: true },
}, (out, calls) => {
  eq(out.status, 'MERGED', 'status')
  eq(out.testRepairs, 1, 'testRepairs')
  ok(calls.includes('repair:build-c1-a1'), 'repair agent ran')
  eq(calls.filter((c) => c.startsWith('integrate')).length, 1, 'Integrate skipped on the non-green build')
})

// 2. defect REFUSED, builder stuck on same failures -> NO-PROGRESS (not BLOCKED after full retries)
await scenario('defect -> REFUSED -> stuck -> NO-PROGRESS', {
  'build': { testsPass: false, summary: 'x', failingTests: ['t::a'], defect: { file: 't.py', problem: 'p', evidence: 'e' } },
  'repair': { verdict: 'REFUSED', rationale: 'the test is right; your code is wrong' },
}, (out, calls) => {
  eq(out.status, 'TEST-DEFECT-HALT', 'status')
  eq(out.reFiled, true, 're-file of a refused claim detected')
  eq(calls.filter((c) => c.startsWith('repair')).length, 1, 'repair budget respected (1)')
  eq(calls.filter((c) => c.startsWith('build')).length, 2, 'stopped at attempt 2, not 3')
  eq(calls.filter((c) => c.startsWith('integrate')).length, 0, 'never paid for Integrate')
})

// 2b. defect REFUSED, builder then stops claiming and is simply stuck -> NO-PROGRESS
await scenario('defect -> REFUSED -> code stuck -> NO-PROGRESS', {
  'build': (calls) => calls.filter((c) => c.startsWith('build')).length === 1
    ? { testsPass: false, summary: 'x', failingTests: ['t::a'], defect: { file: 't.py', problem: 'p', evidence: 'e' } }
    : { testsPass: false, summary: 'x', failingTests: ['t::a'] },
  'repair': { verdict: 'REFUSED', rationale: 'the test is right; your code is wrong' },
}, (out, calls) => {
  eq(out.status, 'NO-PROGRESS', 'status')
  eq(calls.filter((c) => c.startsWith('build')).length, 2, 'refusal already recorded the signature -> abort on the unchanged repeat')
  eq(calls.filter((c) => c.startsWith('integrate')).length, 0, 'never paid for Integrate')
})

// 3. no defect claim, identical failures twice -> NO-PROGRESS
await scenario('identical failures twice -> NO-PROGRESS', {
  'build': { testsPass: false, summary: 'x', failingTests: ['t::a', 't::b'] },
}, (out, calls) => {
  eq(out.status, 'NO-PROGRESS', 'status')
  eq(calls.filter((c) => c.startsWith('build')).length, 2, 'aborted after 2 attempts, not maxRetries+1=3')
  eq(calls.filter((c) => c.startsWith('review')).length, 0, 'no reviewers spent')
})

// 4. validation FAIL / harness -> repair -> re-validate only (no rebuild, no re-review)
await scenario('validate FAIL harness -> repair -> re-validate', {
  'build': { testsPass: true, summary: 'ok' },
  'validate': (calls) => calls.filter((c) => c.startsWith('validate')).length === 1
    ? { status: 'FAIL', evidence: 'pin says 12, staging has 1', faultDomain: 'harness' }
    : { status: 'PASS', evidence: 'measured 60/60' },
  'repair': { verdict: 'REPAIRED', rationale: 'harness pin re-derived for staging', contractPreserved: true },
}, (out, calls) => {
  eq(out.status, 'MERGED', 'status')
  eq(calls.filter((c) => c.startsWith('validate')).length, 2, 're-validated once')
  eq(calls.filter((c) => c.startsWith('build')).length, 1, 'did NOT rebuild (code unchanged)')
  eq(calls.filter((c) => c.startsWith('review')).length, 3, 'did NOT re-review')
}, JSON.stringify({ spec: '/r/backlog/s.md', repo: '/r', env: 'staging', validate: true, merge: true }))

// 5. validation FAIL / code -> one bounded cycle -> rebuild + re-review + re-validate -> ships
await scenario('validate FAIL code -> one bounded cycle', {
  'build': { testsPass: true, summary: 'ok' },
  'validate': (calls) => calls.filter((c) => c.startsWith('validate')).length === 1
    ? { status: 'FAIL', evidence: 'returned 0 rows', faultDomain: 'code' }
    : { status: 'PASS', evidence: 'returned 42 rows' },
}, (out, calls) => {
  eq(out.status, 'MERGED', 'status')
  eq(calls.filter((c) => c.startsWith('build')).length, 2, 'one extra build cycle')
  eq(calls.filter((c) => c.startsWith('review')).length, 6, 're-reviewed the fixed diff')
  ok(calls.includes('build:c2-a1'), 'cycle 2 labels are distinct (resume cache safety)')
}, JSON.stringify({ spec: '/r/backlog/s.md', repo: '/r', env: 'staging', validate: true, merge: true }))

// 6. validation FAIL / environment -> immediate halt, no repair, no rebuild
await scenario('validate FAIL environment -> immediate halt', {
  'build': { testsPass: true, summary: 'ok' },
  'validate': { status: 'FAIL', evidence: 'db unreachable', faultDomain: 'environment' },
}, (out, calls) => {
  eq(out.status, 'VALIDATION-FAILED', 'status')
  eq(out.faultDomain, 'environment', 'faultDomain surfaced')
  eq(calls.filter((c) => c.startsWith('repair')).length, 0, 'no repair attempted')
  eq(calls.filter((c) => c.startsWith('build')).length, 1, 'no rebuild')
}, JSON.stringify({ spec: '/r/backlog/s.md', repo: '/r', env: 'staging', validate: true, merge: true }))

// 7. regression: the ordinary happy path still ships unchanged
await scenario('happy path unchanged', {
  'build': { testsPass: true, summary: 'ok' },
}, (out, calls) => {
  eq(out.status, 'MERGED', 'status')
  eq(out.testRepairs, 0, 'no repairs')
  eq(calls.filter((c) => c.startsWith('build')).length, 1, 'single build')
})

// 8. regression: pre-existing BLOCKED path (reviewers keep rejecting) still terminates
await scenario('reviewers reject -> BLOCKED', {
  'build': { testsPass: true, summary: 'ok' },
  'review': { dimension: 'd', status: 'REJECT', findings: [{ severity: 'High', problem: 'bug' }] },
}, (out, calls) => {
  eq(out.status, 'BLOCKED', 'status')
  eq(calls.filter((c) => c.startsWith('build')).length, 3, 'used maxRetries+1 build attempts')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
