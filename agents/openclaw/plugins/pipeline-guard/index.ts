// pipeline-guard
//
// Tool-layer enforcement of Juliet's 9-stage build pipeline. Four gates on
// sessions_spawn (before + after), governed by per-orchestrator state.
//
//   Gate 1 (pipelineGate): bare dispatch of a per-stage skill (builder /
//                          tester / reviewer / validator) is rejected
//                          unless it comes from the pipeline-orchestrator.
//   Gate 2 (specGate):     builder spawns must reference an existing
//                          backlog/<spec>.md file in the workspace.
//   Gate 3 (worktreeGate): every per-stage spawn from the orchestrator
//                          gets a physically-allocated git worktree
//                          (created via child_process.execFileSync from
//                          inside this hook). Task is rewritten to point
//                          at the worktree path.
//   Gate 4 (reviewGate):   after a builder spawn returns successfully,
//                          the orchestrator's NEXT sessions_spawn must
//                          be the adversarial-reviewer. Other tool calls
//                          (exec, edit, sessions_yield) pass through.
//
// Each gate has a mode: log (detect + log, never block), rewrite (gate 3
// only — actually create the worktree), reject (block on violation).
// Default for all gates: log.
//
// Failure policy: any unexpected error in a hook returns undefined so the
// tool call passes through. Gates fail OPEN, not closed — a buggy guard
// must never block legitimate work.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const STATUS_FILE = "/tmp/pipeline-guard-status.json";
// Tags file lives under /home/node/.openclaw/ (bind-mounted from
// ~/agent-hub/harnesses/openclaw/config on the host) so it survives
// container restarts. /tmp does NOT survive container restart.
const TAGS_DIR = "/home/node/.openclaw/.pipeline-guard";
const TAGS_FILE = `${TAGS_DIR}/tags.json`;

// ---------------------------------------------------------------------------
// Constants & defaults

const SPAWN_TOOL = "sessions_spawn";

const DEFAULTS = {
  repoRoot: "/app/repo",
  worktreeBase: "/tmp/openclaw-worktrees",
  workspaceRoot: "/home/node/.openclaw/workspace",
  stageSkillBasenames: [
    // 9-stage pipeline (v0.x)
    "builder",
    "adversarial-tester",
    "test-reviewer",
    "adversarial-reviewer",
    "validator",
    // 15-stage pipeline additions (v0.10+)
    "spec-reviewer",
    "system-architect",
    "architecture-reviewer",
    "code-quality-checker",
    "integration-validator",
    "post-merge-validator",
  ],
  orchestratorSkillBasename: "pipeline-orchestrator",
  stateTtlMs: 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// Per-orchestrator state.
//
// Keyed by ctx.sessionId of the orchestrator session. Each entry carries
// the most recent worktree path (so a single orchestrator's stages reuse
// the same worktree) and the current pipeline stage state for gate 4.

type Stage = "IDLE" | "NEEDS_REVIEW" | "NEEDS_VALIDATE";

interface OrchState {
  worktreePath?: string;
  branch?: string;
  stage: Stage;
  // Whether the adversarial-reviewer has been dispatched since the last
  // builder spawn returned. Used by gate 4 to enforce the user's rule:
  // "validator must not run before reviewer has reviewed the latest build."
  reviewerRanSinceLastBuilder: boolean;
  // v0.10: 15-stage pipeline flags.
  // specReviewerRan / systemArchitectRan / architectureReviewerRan are sticky for the
  // orch's lifetime — once a spec/design has been authored or reviewed for
  // this orch session, that outcome stands until the orch session ends or
  // TTL'd. They gate BUILD.
  specReviewerRan: boolean;
  systemArchitectRan: boolean;
  architectureReviewerRan: boolean;
  // hasBuilderRun: true after the first builder dispatch in this orch.
  // Used by qualityGate to NOT block the test-first stage (no builder yet).
  hasBuilderRun: boolean;
  // qualityCheckerRanSinceLastBuilder: true after a code-quality-checker run,
  // false after a builder dispatch. Gates BUILD VALIDATION (the post-builder
  // adversarial-tester pass) so it cannot run on un-quality-checked code.
  qualityCheckerRanSinceLastBuilder: boolean;
  updatedAt: number;
}

const orchStates = new Map<string, OrchState>();
// Sessions whose prompt content has been seen referencing the
// pipeline-orchestrator skill. This is the only available proxy for
// "is this session running the orchestrator skill" — openclaw has no
// structural session→skill mapping. Populated lazily by before_prompt_build
// inspecting event.prompt + event.messages for the orchestrator's
// SKILL.md path or signature prose.
const orchestratorSessions = new Set<string>();
// Sessions whose prompt has been seen referencing a stage skill
// (builder/tester/reviewer/validator). Used so we can later detect
// nested re-dispatches if needed.
const stageSessions = new Map<string, string>();

function gcStates(ttlMs: number) {
  const cutoff = Date.now() - ttlMs;
  let removed = false;
  for (const [sid, s] of orchStates) {
    if (s.updatedAt < cutoff) {
      orchStates.delete(sid);
      orchestratorSessions.delete(sid);
      stageSessions.delete(sid);
      removed = true;
    }
  }
  if (removed) persistTags();
}

// Persistent tag storage. Without this, every container restart wipes
// orchestratorSessions and orchStates from memory. In-flight orchestrators
// then look "untagged" until before_prompt_build re-fires for them on
// their next LLM turn — creating a window where gate 1 in reject mode
// could falsely block legitimate orchestrator dispatches.
function persistTags(): void {
  try {
    mkdirSync(TAGS_DIR, { recursive: true });
    const blob = {
      orchestratorSessions: Array.from(orchestratorSessions),
      stageSessions: Object.fromEntries(stageSessions),
      orchStates: Object.fromEntries(orchStates),
      ts: new Date().toISOString(),
    };
    writeFileSync(TAGS_FILE, JSON.stringify(blob, null, 2) + "\n");
  } catch {
    /* persistence is best-effort; never throw from a hook */
  }
}

function loadTags(api: any): void {
  try {
    if (!existsSync(TAGS_FILE)) return;
    const raw = readFileSync(TAGS_FILE, "utf8");
    const blob = JSON.parse(raw);
    if (Array.isArray(blob.orchestratorSessions)) {
      for (const sid of blob.orchestratorSessions) {
        if (typeof sid === "string") orchestratorSessions.add(sid);
      }
    }
    if (blob.stageSessions && typeof blob.stageSessions === "object") {
      for (const [sid, st] of Object.entries(blob.stageSessions)) {
        if (typeof st === "string") stageSessions.set(sid, st);
      }
    }
    if (blob.orchStates && typeof blob.orchStates === "object") {
      for (const [sid, s] of Object.entries(blob.orchStates)) {
        if (s && typeof s === "object") {
          const st = s as Partial<OrchState>;
          orchStates.set(sid, {
            stage: (st.stage as Stage) ?? "IDLE",
            reviewerRanSinceLastBuilder: st.reviewerRanSinceLastBuilder ?? false,
            specReviewerRan: st.specReviewerRan ?? false,
            systemArchitectRan: st.systemArchitectRan ?? false,
            architectureReviewerRan: st.architectureReviewerRan ?? false,
            hasBuilderRun: st.hasBuilderRun ?? false,
            qualityCheckerRanSinceLastBuilder: st.qualityCheckerRanSinceLastBuilder ?? false,
            updatedAt: st.updatedAt ?? Date.now(),
            ...(st.worktreePath ? { worktreePath: st.worktreePath } : {}),
            ...(st.branch ? { branch: st.branch } : {}),
          });
        }
      }
    }
    api.logger?.info?.(
      `pipeline-guard: restored tags from ${TAGS_FILE} — orch=${orchestratorSessions.size} stages=${stageSessions.size} states=${orchStates.size}`,
    );
  } catch (err: any) {
    api.logger?.warn?.(`pipeline-guard: failed to restore tags: ${err?.message ?? String(err)}`);
  }
}

function getOrInitState(sessionId: string): OrchState {
  let s = orchStates.get(sessionId);
  if (!s) {
    s = {
      stage: "IDLE",
      reviewerRanSinceLastBuilder: false,
      specReviewerRan: false,
      systemArchitectRan: false,
      architectureReviewerRan: false,
      hasBuilderRun: false,
      qualityCheckerRanSinceLastBuilder: false,
      updatedAt: Date.now(),
    };
    orchStates.set(sessionId, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Task-string parsing helpers. The orchestrator skill emits structured
// substrings (`Spec: backlog/...md`, `Branch: feat/...`, `Repository: ...`)
// per BUILD_PIPELINE.md. Parsing these is brittle but matches what the
// skill actually produces today.

function parseField(task: string, label: string): string | undefined {
  const re = new RegExp(`${label}\\s*:\\s*([^\\n]+)`, "i");
  const m = task.match(re);
  if (!m) return undefined;
  let val = m[1];
  // v0.13: stop at the next-field boundary on the same line. LLMs sometimes
  // emit "Spec: /path.md. Repository: ... Branch: ..." all on one line, which
  // makes parseField's `[^\n]+` greedy-match swallow the rest. Cut at the
  // first occurrence of `. <KnownLabel>:` so the value ends where the next
  // structured field begins.
  const NEXT_FIELD_RE = /\.\s+(?:Repository|Branch|Spec|Parent[\s-]?Branch|Test\s+file|YOU\s+MUST|Run|Make|Commit|DO\s+NOT)\s*:?\s/i;
  const cutIdx = val.search(NEXT_FIELD_RE);
  if (cutIdx > 0) {
    val = val.slice(0, cutIdx);
  }
  // Strip markdown formatting the LLM may have wrapped values in:
  //   **Field:** `value`   →   value
  //   "Field": "value"     →   value
  // Plus trailing punctuation like trailing periods/commas/asterisks.
  return val
    .trim()
    .replace(/^[*`'"\s]+/, "")
    .replace(/[*`'",.\s]+$/, "");
}

// Parse a feat/<name> branch reference from a task string. The orchestrator's
// SKILL.md is inconsistent across stages — some templates use the structured
// "Branch: feat/X" form, others use prose like "on branch feat/X" or
// "review code on branch feat/X". Try both.
function parseBranch(task: string): string | undefined {
  // Extract just the branch token from the structured "Branch: <token> ..."
  // form. parseField captures everything to end-of-line (including trailing
  // prose like "feat/X (tests already committed there)"), which would feed
  // garbage to `git worktree add`. Match the prefix-and-name token only.
  // v0.13: expanded prefix list to include `feature`, `bugfix`, `hotfix`,
  // `release`. Common in real-world git flows; the v0.x list missed them and
  // legitimate orch dispatches on `feature/X` branches were silently
  // unrecognized (worktreeGate would log "missing branch" and not allocate).
  const PREFIXES = "feat|feature|fix|bugfix|hotfix|chore|refactor|perf|docs|test|release";
  const structured = parseField(task, "Branch");
  if (structured) {
    const m = structured.match(new RegExp(`^((?:${PREFIXES})\\/[\\w./-]+)`));
    if (m) return m[1].replace(/[.,]+$/, "");
  }
  const prose = task.match(new RegExp(`\\bbranch\\s+((?:${PREFIXES})\\/[\\w./-]+)`, "i"));
  if (prose) return prose[1].replace(/[.,]+$/, "");
  return undefined;
}

function detectStageSkill(task: string, stageBasenames: string[]): string | undefined {
  // Match either an explicit path (".../skills/<basename>/SKILL.md") or
  // an unambiguous mention ("You are the BUILDER", "adversarial-tester").
  for (const s of stageBasenames) {
    if (task.includes(`/${s}/SKILL.md`)) return s;
  }
  for (const s of stageBasenames) {
    const re = new RegExp(`\\b${s.replace(/-/g, "[-\\s]")}\\b`, "i");
    if (re.test(task)) return s;
  }
  return undefined;
}

// Heuristic detection of code-modifying intent for spawns that bypass the
// SKILL.md-loading convention. Catches the failure mode where the caller
// sends an ad-hoc task ("Add a docstring to function X in file Y") with no
// structural marker. We treat such tasks as implicit "builder" dispatches
// so specGate / pipelineGate / worktreeGate still engage.
//
// Signals (any one is enough):
//   - spawn `params.label` contains a stage basename (e.g. "builder-fix-foo")
//   - task contains a stage basename literal that ALSO co-occurs with an
//     edit verb (catches "have a builder add X")
//   - task references a code path AND uses an edit verb (the bypass pattern)
//
// We default to "builder" for the path+verb case since builder is the
// code-modifying catch-all. False positives on memory / research subagents
// are bounded because those tasks rarely combine repo-relative file paths
// with imperative edit verbs.

const EDIT_VERB_RE = /\b(?:add|fix|modify|edit|update|remove|delete|refactor|rewrite|implement|build|change|create|append|prepend|insert|patch|replace)\b/i;
// Note: .md is intentionally EXCLUDED so memory / research / docs subagents
// that mention markdown paths don't false-positive as builder dispatches.
// If a real builder needs to edit markdown only, it should still go through
// pipeline-orchestrator (which carries the SKILL.md marker → explicit
// detection takes precedence over this heuristic).
const CODE_PATH_RE = /(?:^|[\s`"'(])(?:\.{0,2}\/)?(?:app\/|home\/node\/[^\/\s]*\/|src\/|scripts\/|tests?\/|lib\/)[\w\-./]+\.(?:py|ts|tsx|js|jsx|mjs|cjs|json|yaml|yml|toml|sql|sh|rs|go|java|cpp|c|h|hpp)\b/i;

function detectImplicitStage(
  task: string,
  params: any,
  stageBasenames: string[],
): { stage: string; reason: string } | undefined {
  // Signal 1: label hints
  const label = typeof params?.label === "string" ? params.label : "";
  if (label) {
    const labelLower = label.toLowerCase();
    for (const s of stageBasenames) {
      const collapsed = s.replace(/-/g, "");
      if (labelLower.includes(s) || labelLower.includes(collapsed)) {
        return { stage: s, reason: `label="${label}"` };
      }
    }
  }

  // Signal 2: stage basename mentioned in task with an edit verb nearby
  for (const s of stageBasenames) {
    const wordRe = new RegExp(`\\b${s.replace(/-/g, "[-\\s]")}\\b`, "i");
    if (wordRe.test(task) && EDIT_VERB_RE.test(task)) {
      return { stage: s, reason: `task mentions "${s}" + edit verb` };
    }
  }

  // Signal 3: code path + edit verb (the ad-hoc-builder bypass pattern)
  const hasCodePath = CODE_PATH_RE.test(task);
  const hasEditVerb = EDIT_VERB_RE.test(task);
  if (hasCodePath && hasEditVerb) {
    return { stage: "builder", reason: "task references code path with edit verb" };
  }

  return undefined;
}

function detectOrchestratorSkill(task: string, orchestrator: string): boolean {
  return (
    task.includes(`/${orchestrator}/SKILL.md`) ||
    new RegExp(`\\b${orchestrator}\\b`, "i").test(task)
  );
}

function slugify(s: string): string {
  return s.replace(/[^\w-]+/g, "-").slice(0, 64);
}

// ---------------------------------------------------------------------------
// Worktree management. Side-effecting; only called from gate 3 in `rewrite`
// mode.

function ensureWorktree(opts: {
  repoRoot: string;
  worktreeBase: string;
  branch: string;
  sessionId: string;
}): string {
  const tag = slugify(opts.sessionId).slice(0, 12) || "anon";
  const wtPath = path.join(opts.worktreeBase, `${slugify(opts.branch)}-${tag}`);

  mkdirSync(opts.worktreeBase, { recursive: true });

  // Already a working worktree? Trust git's view, not just disk.
  let alreadyWorktree = false;
  try {
    const list = execFileSync("git", ["-C", opts.repoRoot, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
    });
    alreadyWorktree = list.split("\n").some((line) => line === `worktree ${wtPath}`);
  } catch {
    /* fall through to add */
  }

  if (alreadyWorktree) return wtPath;

  // If the dir exists but isn't a registered worktree, clear it.
  if (existsSync(wtPath)) {
    try {
      execFileSync("git", ["-C", opts.repoRoot, "worktree", "remove", "--force", wtPath], {
        encoding: "utf8",
      });
    } catch {
      try {
        rmSync(wtPath, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  execFileSync(
    "git",
    ["-C", opts.repoRoot, "worktree", "add", "--force", wtPath, opts.branch],
    { encoding: "utf8" },
  );
  return wtPath;
}

// Build a snapshot of all tracked state for visibility (both as a one-line
// log emit and a structured JSON file at STATUS_FILE).
function buildStatus(): { line: string; json: any } {
  const orchEntries: any[] = [];
  for (const [sid, s] of orchStates) {
    orchEntries.push({
      sessionIdShort: sid.slice(0, 8),
      stage: s.stage,
      branch: s.branch ?? null,
      worktreePath: s.worktreePath ?? null,
      ageSec: Math.floor((Date.now() - s.updatedAt) / 1000),
    });
  }
  const stageCounts: Record<string, number> = {};
  for (const [, st] of stageSessions) {
    stageCounts[st] = (stageCounts[st] ?? 0) + 1;
  }
  const json = {
    ts: new Date().toISOString(),
    orchestratorsTracked: orchestratorSessions.size,
    stageSessionsTracked: stageSessions.size,
    pipelineStates: orchEntries,
    stageCounts,
  };
  const orchSummary = orchEntries.length === 0
    ? "none"
    : orchEntries
        .map((o) => `${o.sessionIdShort}:${o.stage}${o.branch ? `/${o.branch}` : ""}${o.worktreePath ? "+wt" : ""}`)
        .join(",");
  const stageSummary = Object.entries(stageCounts).length === 0
    ? "none"
    : Object.entries(stageCounts).map(([s, n]) => `${s}:${n}`).join(",");
  const line = `pipeline-guard STATUS: orch=[${orchSummary}] stages=[${stageSummary}] orchTagged=${orchestratorSessions.size}`;
  return { line, json };
}

function emitStatus(api: any, reason: string): void {
  try {
    const { line, json } = buildStatus();
    api.logger?.info?.(`${line} (reason=${reason})`);
    writeFileSync(STATUS_FILE, JSON.stringify({ ...json, reason }, null, 2) + "\n");
  } catch (err: any) {
    api.logger?.warn?.(`pipeline-guard: emitStatus failed: ${err?.message ?? String(err)}`);
  }
}

function teardownWorktree(repoRoot: string, wtPath: string): void {
  try {
    execFileSync("git", ["-C", repoRoot, "worktree", "remove", "--force", wtPath], {
      encoding: "utf8",
    });
  } catch {
    /* best effort; daily prune cron is the safety net */
  }
}

// ---------------------------------------------------------------------------
// Task rewriting. Strips bare `git checkout feat/...` lines and prepends
// a cwd directive pointing at the allocated worktree.

const CHECKOUT_RE = /^[ \t]*git checkout\s+\S+.*$/gim;

function rewriteTaskWithWorktree(task: string, worktreePath: string, branch: string): string {
  const cleaned = task.replace(
    CHECKOUT_RE,
    "# (pipeline-guard removed inline checkout — worktree is pre-allocated)",
  );
  const preamble = [
    `# pipeline-guard: isolated worktree pre-allocated by the harness`,
    `# Worktree: ${worktreePath}`,
    `# Branch:   ${branch}`,
    `# DO NOT run \`git checkout\` — your cwd is already on this branch.`,
    `cd ${worktreePath}`,
    ``,
  ].join("\n");
  return `${preamble}${cleaned}`;
}

// ---------------------------------------------------------------------------
// Build a structured rejection. The before_tool_call runtime expects
// `{ blocked: true, reason: string }` from hooks that want to block a
// tool call (per /app/dist/pi-tools.before-tool-call-*.js). Returning
// any other shape (including { result: {...} }) lets the call proceed.
// The runtime throws `new Error(reason)` to surface the block to the LLM.

// Plugin hooks return { block: true, blockReason } per
// /app/dist/pi-tools.before-tool-call-*.js — the wrapper translates that
// to outcome.blocked / outcome.reason. Field names are SINGULAR (block,
// blockReason), not plural (blocked, reason). Returning the wrong shape
// silently lets the call proceed.
function rejection(message: string) {
  return {
    block: true,
    blockReason: `[pipeline-guard] ${message}`,
  };
}

// ---------------------------------------------------------------------------
// Plugin entry

export default {
  id: "pipeline-guard",
  name: "Pipeline Guard",
  description:
    "Enforces Juliet's 9-stage build pipeline at the tool layer. Four gates on sessions_spawn.",
  configSchema: { type: "object", additionalProperties: true },
  register(api: any) {
    // api.config is the full openclaw config; api.pluginConfig is the
    // plugin-specific validated config from openclaw.json plugins.entries.<id>.config.
    const cfg = api.pluginConfig ?? {};
    const repoRoot = cfg.repoRoot ?? DEFAULTS.repoRoot;
    const worktreeBase = cfg.worktreeBase ?? DEFAULTS.worktreeBase;
    const workspaceRoot = cfg.workspaceRoot ?? DEFAULTS.workspaceRoot;
    const stageBasenames: string[] = cfg.stageSkillBasenames ?? DEFAULTS.stageSkillBasenames;
    const orchestratorSkill: string = cfg.orchestratorSkillBasename ?? DEFAULTS.orchestratorSkillBasename;
    const stateTtlMs: number = cfg.stateTtlMs ?? DEFAULTS.stateTtlMs;

    const pipelineGate = cfg.pipelineGate ?? { enabled: true, mode: "log" };
    const specGate = cfg.specGate ?? { enabled: true, mode: "log" };
    const worktreeGate = cfg.worktreeGate ?? { enabled: true, mode: "log" };
    const reviewGate = cfg.reviewGate ?? { enabled: true, mode: "log" };
    // v0.10: 15-stage pipeline gates. Default to log mode.
    const specReviewGate = cfg.specReviewGate ?? { enabled: true, mode: "log" };
    const systemArchitectGate = cfg.systemArchitectGate ?? { enabled: true, mode: "log" };
    const architectureReviewGate = cfg.architectureReviewGate ?? { enabled: true, mode: "log" };
    const qualityGate = cfg.qualityGate ?? { enabled: true, mode: "log" };

    api.logger?.info?.(
      `pipeline-guard v0.16: pipeline=${pipelineGate.mode} spec=${specGate.mode} worktree=${worktreeGate.mode} review=${reviewGate.mode} specReview=${specReviewGate.mode} systemArchitect=${systemArchitectGate.mode} architectureReview=${architectureReviewGate.mode} quality=${qualityGate.mode} statusFile=${STATUS_FILE} tagsFile=${TAGS_FILE}`,
    );
    // Restore in-memory tags from previous run, so a container restart
    // doesn't briefly un-tag every in-flight orchestrator session.
    loadTags(api);
    // Note: deliberately not emitting startup STATUS here. register() runs
    // on every per-session plugin bootstrap, which would flood the log.
    // STATUS only fires on real state changes (TAGGED + transitions).

    // Skill detection by prompt-content inspection.
    //
    // OpenClaw doesn't track which skill a session is running — skills are
    // prose instructions in spawn task strings. So we detect by scanning
    // the prompt + message history for skill-specific markers (the literal
    // "<skill>/SKILL.md" path that the spawn task referenced). This fires
    // on every LLM turn so detection latches as soon as the session has
    // had at least one prompt build. before_prompt_build's event carries
    // { prompt, messages } per agent-harness-runtime resolveAgentHarness-
    // BeforePromptBuildResult.
    const ORCH_MARKER = `/${orchestratorSkill}/SKILL.md`;
    const STAGE_MARKERS = stageBasenames.map((s) => ({
      stage: s,
      marker: `/${s}/SKILL.md`,
    }));
    // Detection scan sources:
    //   - event.prompt (the system prompt — stable per session)
    //   - first user message in event.messages (the spawn task that
    //     defines this session's role)
    // Combine both so we catch the marker regardless of which surface
    // openclaw exposed it on for this turn.
    function getFirstUserMessageText(event: any): string {
      const messages = Array.isArray(event?.messages) ? event.messages : [];
      for (const m of messages) {
        if (typeof m === "string") return m;
        if (m?.role === "user") {
          if (typeof m.content === "string") return m.content;
          if (Array.isArray(m.content)) {
            const parts: string[] = [];
            for (const c of m.content) {
              if (typeof c?.text === "string") parts.push(c.text);
            }
            return parts.join("\n");
          }
        }
      }
      return "";
    }

    // Stage signature phrases — these only appear in spawn tasks that
    // explicitly assign a session to that stage role ("You are the BUILDER").
    // We REQUIRE the signature phrase for stage tagging (not just the
    // SKILL.md path) because the orchestrator's own prompt naturally
    // enumerates every stage's SKILL.md path in its task templates,
    // which would falsely tag the orchestrator as every stage at once.
    const STAGE_SIGNATURES: Record<string, string> = {
      "builder": "You are the BUILDER",
      "adversarial-tester": "You are the ADVERSARIAL TESTER",
      "test-reviewer": "You are the TEST REVIEWER",
      "adversarial-reviewer": "You are the ADVERSARIAL REVIEWER",
      "validator": "You are the VALIDATOR",
      // v0.10: 15-stage pipeline subagents
      "spec-reviewer": "You are the SPEC REVIEWER",
      "system-architect": "You are the SYSTEM ARCHITECT",
      "architecture-reviewer": "You are the ARCHITECTURE REVIEWER",
      "code-quality-checker": "You are the CODE QUALITY CHECKER",
      "integration-validator": "You are the INTEGRATION VALIDATOR",
      "post-merge-validator": "You are the POST-MERGE VALIDATOR",
    };

    function inspectPromptForSkill(event: any): { isOrch: boolean; stage?: string } {
      const buf: string[] = [];
      if (typeof event?.prompt === "string") buf.push(event.prompt);
      buf.push(getFirstUserMessageText(event));
      const scanText = buf.join("\n");
      if (!scanText.trim()) return { isOrch: false };

      // Orchestrator detection: SKILL.md path or signature phrase. The
      // orchestrator session's own task instructs it to read this path.
      const isOrch = scanText.includes(ORCH_MARKER) ||
                     scanText.includes("You manage the 9-stage build pipeline");

      // Stage detection: require signature phrase (path alone is too noisy).
      let stage: string | undefined;
      for (const [s, phrase] of Object.entries(STAGE_SIGNATURES)) {
        if (scanText.includes(phrase)) { stage = s; break; }
      }
      return { isOrch, stage };
    }

    api.on("before_prompt_build", async (event: any, ctx: any) => {
      try {
        const sessionId = ctx?.sessionId;
        if (!sessionId) return;
        const { isOrch, stage } = inspectPromptForSkill(event);
        // Orchestrator detection takes priority — the orchestrator's prompt
        // legitimately references every stage skill it dispatches, so naive
        // stage detection would mis-tag it. Only tag as stage if NOT also
        // tagged as orchestrator.
        if (isOrch) {
          if (!orchestratorSessions.has(sessionId)) {
            orchestratorSessions.add(sessionId);
            persistTags();
            api.logger?.info?.(
              `pipeline-guard: TAGGED session=${sessionId.slice(0, 8)} as orchestrator (saw ${ORCH_MARKER})`,
            );
            emitStatus(api, `tagged-orch:${sessionId.slice(0, 8)}`);
          }
        } else if (stage && stageSessions.get(sessionId) !== stage) {
          stageSessions.set(sessionId, stage);
          persistTags();
          api.logger?.info?.(
            `pipeline-guard: TAGGED session=${sessionId.slice(0, 8)} as stage=${stage}`,
          );
          emitStatus(api, `tagged-stage:${stage}`);
        }
      } catch {
        /* never throw from a hook */
      }
      return;
    });

    api.on("before_tool_call", async (event: any, ctx: any) => {
      try {
        gcStates(stateTtlMs);

        if (event?.toolName !== SPAWN_TOOL) return;

        const params = (event.params && typeof event.params === "object") ? event.params : {};
        const task = typeof params.task === "string" ? params.task : "";
        const sessionId: string = ctx?.sessionId ?? ctx?.runId ?? "anon";
        const callerIsOrchestrator = orchestratorSessions.has(sessionId);
        const callerStage = stageSessions.get(sessionId);
        const explicitStage = detectStageSkill(task, stageBasenames);
        const targetIsOrchestrator = detectOrchestratorSkill(task, orchestratorSkill);

        // If structural detection failed, fall back to heuristics — catches
        // ad-hoc "Add X to file.py" style spawns that bypass the SKILL.md
        // convention. Skip implicit detection when the spawn target is the
        // orchestrator itself (its task naturally references stage skills
        // and code paths).
        let targetStage = explicitStage;
        let implicitReason: string | undefined;
        if (!targetStage && !targetIsOrchestrator) {
          const implicit = detectImplicitStage(task, params, stageBasenames);
          if (implicit) {
            targetStage = implicit.stage;
            implicitReason = implicit.reason;
          }
        }

        // Unconditional observability — proves the hook fires for every
        // sessions_spawn regardless of gate outcomes.
        api.logger?.info?.(
          `pipeline-guard: SAW sessions_spawn session=${sessionId.slice(0, 8)} callerIsOrch=${callerIsOrchestrator} callerStage=${callerStage ?? "none"} targetStage=${targetStage ?? "none"}${implicitReason ? `(implicit:${implicitReason})` : ""} targetIsOrch=${targetIsOrchestrator} taskLen=${task.length}`,
        );

        if (!task) return;

        // -------------------------------------------------------------------
        // Gate 1 — Pipeline gate. Per-stage spawns must come from a session
        // that has been tagged as the orchestrator (via prompt-content
        // inspection in before_prompt_build). Spawning the orchestrator
        // itself is always fine — that's how a pipeline run begins.
        if (pipelineGate.enabled && targetStage && !targetIsOrchestrator) {
          if (!callerIsOrchestrator) {
            const msg = `pipelineGate: spawn of stage skill "${targetStage}" must come from a ${orchestratorSkill} session (caller session=${sessionId.slice(0, 8)} was not tagged as orchestrator${callerStage ? `; tagged as stage=${callerStage}` : ""}). Spawn ${orchestratorSkill} instead.`;
            if (pipelineGate.mode === "reject") {
              api.logger?.warn?.(`pipeline-guard: BLOCK ${msg}`);
              return rejection(msg);
            }
            api.logger?.info?.(`pipeline-guard(log): ${msg}`);
          }
        }

        // -------------------------------------------------------------------
        // Gate 2 — Spec gate. Builder spawns must reference an existing
        // spec file under the workspace. Skip when the target is the
        // orchestrator itself — its task naturally references stage skills,
        // which would otherwise false-positive as a builder dispatch.
        if (specGate.enabled && targetStage === "builder" && !targetIsOrchestrator) {
          const specRel = parseField(task, "Spec");
          if (!specRel) {
            const msg = `specGate: builder spawn missing "Spec: backlog/<file>.md" line in task.`;
            if (specGate.mode === "reject") {
              api.logger?.warn?.(`pipeline-guard: BLOCK ${msg}`);
              return rejection(msg);
            }
            api.logger?.info?.(`pipeline-guard(log): ${msg}`);
          } else {
            const abs = path.isAbsolute(specRel) ? specRel : path.join(workspaceRoot, specRel);
            let exists = false;
            try {
              exists = statSync(abs).isFile();
            } catch {
              exists = false;
            }
            if (!exists) {
              const msg = `specGate: builder spawn references spec "${specRel}" which does not exist at ${abs}. Write the spec first.`;
              if (specGate.mode === "reject") {
                api.logger?.warn?.(`pipeline-guard: BLOCK ${msg}`);
                return rejection(msg);
              }
              api.logger?.info?.(`pipeline-guard(log): ${msg}`);
            }
          }
        }

        // -------------------------------------------------------------------
        // Gate 2b — Spec-review gate (v0.10). Builder spawns must come after
        // a spec-reviewer ran in this orchestrator session. Sticky once true.
        if (specReviewGate.enabled && targetStage === "builder" && !targetIsOrchestrator) {
          const state = getOrInitState(sessionId);
          if (!state.specReviewerRan) {
            const msg = `specReviewGate: builder dispatched without prior spec-reviewer run in this orch session. Run Stage 2 (SPEC REVIEW) first.`;
            if (specReviewGate.mode === "reject") {
              api.logger?.warn?.(`pipeline-guard: BLOCK ${msg}`);
              return rejection(msg);
            }
            api.logger?.info?.(`pipeline-guard(log): ${msg}`);
          }
        }

        // -------------------------------------------------------------------
        // Gate 2b' — System-architect gate (v0.16). Architecture-reviewer
        // spawns must come after a system-architect ran in this orchestrator
        // session. Closes the gap where an orch could satisfy
        // architectureReviewGate without ever producing a design — pre-v0.16
        // orchs were observed dispatching spec-reviewer → architecture-reviewer
        // → builder with no system-architect in between.
        if (systemArchitectGate.enabled && targetStage === "architecture-reviewer" && !targetIsOrchestrator) {
          const state = getOrInitState(sessionId);
          if (!state.systemArchitectRan) {
            const msg = `systemArchitectGate: architecture-reviewer dispatched without prior system-architect run in this orch session. Run Stage 3 (ARCHITECTURE) first.`;
            if (systemArchitectGate.mode === "reject") {
              api.logger?.warn?.(`pipeline-guard: BLOCK ${msg}`);
              return rejection(msg);
            }
            api.logger?.info?.(`pipeline-guard(log): ${msg}`);
          }
        }

        // -------------------------------------------------------------------
        // Gate 2c — Architecture-review gate (v0.10, renamed v0.16). Builder
        // spawns must come after an architecture-reviewer ran in this
        // orchestrator session.
        if (architectureReviewGate.enabled && targetStage === "builder" && !targetIsOrchestrator) {
          const state = getOrInitState(sessionId);
          if (!state.architectureReviewerRan) {
            const msg = `architectureReviewGate: builder dispatched without prior architecture-reviewer run in this orch session. Run Stage 4 (ARCHITECTURE REVIEW) first.`;
            if (architectureReviewGate.mode === "reject") {
              api.logger?.warn?.(`pipeline-guard: BLOCK ${msg}`);
              return rejection(msg);
            }
            api.logger?.info?.(`pipeline-guard(log): ${msg}`);
          }
        }

        // -------------------------------------------------------------------
        // Gate 3 — Worktree gate. Per-stage spawns get a physically-allocated
        // git worktree. Same orchestrator session reuses the same worktree
        // across all stages of one pipeline run.
        //
        // v0.13: skip when the spawn TARGET is an orchestrator (even if the
        // task also mentions a stage skill in passing). The new orchestrator
        // child will allocate its own worktree on its first stage spawn;
        // pre-allocating here just creates a phantom OrchState entry on the
        // parent (e.g., Juliet's main session) that never gets cleaned up
        // until TTL.
        let rewrittenTask: string | undefined;
        if (worktreeGate.enabled && targetStage && !targetIsOrchestrator) {
          const branch = parseBranch(task);
          if (!branch) {
            const msg = `worktreeGate: stage spawn missing recognizable branch reference (need "Branch: feat/<name>" or "Branch: fix/<name>" etc.) in task.`;
            if (worktreeGate.mode === "reject") {
              api.logger?.warn?.(`pipeline-guard: BLOCK ${msg}`);
              return rejection(msg);
            }
            api.logger?.info?.(`pipeline-guard(log): ${msg}`);
          } else if (worktreeGate.mode === "rewrite") {
            try {
              const state = getOrInitState(sessionId);
              // Reuse the orchestrator's existing worktree if branch matches.
              let wtPath = state.worktreePath;
              if (!wtPath || state.branch !== branch) {
                wtPath = ensureWorktree({ repoRoot, worktreeBase, branch, sessionId });
                state.worktreePath = wtPath;
                state.branch = branch;
                state.updatedAt = Date.now();
                persistTags();
              }
              rewrittenTask = rewriteTaskWithWorktree(task, wtPath, branch);
              api.logger?.info?.(
                `pipeline-guard(rewrite): branch=${branch} session=${sessionId.slice(0, 8)} → ${wtPath}`,
              );
            } catch (err: any) {
              const msg = `worktreeGate: failed to allocate worktree for branch ${branch}: ${err?.message ?? String(err)}`;
              api.logger?.warn?.(`pipeline-guard: BLOCK ${msg}`);
              return rejection(msg);
            }
          } else if (worktreeGate.mode === "reject") {
            // Reject if task doesn't already reference a worktree path.
            if (!task.includes(worktreeBase)) {
              const msg = `worktreeGate: task does not reference a worktree under ${worktreeBase}.`;
              api.logger?.warn?.(`pipeline-guard: BLOCK ${msg}`);
              return rejection(msg);
            }
          } else {
            api.logger?.info?.(
              `pipeline-guard(log): would rewrite spawn for branch=${branch}`,
            );
          }
        }

        // -------------------------------------------------------------------
        // Gate 4 — Review reflex. Cardinal rule: validator cannot run if
        // the adversarial-reviewer hasn't been dispatched since the most
        // recent builder spawn. Captures the user's intent ("review must
        // happen before validation") without over-restricting the rework
        // path (BLOCKED → builder, additional tester runs, etc.).
        if (reviewGate.enabled && targetStage === "validator" && !targetIsOrchestrator) {
          const state = getOrInitState(sessionId);
          if (!state.reviewerRanSinceLastBuilder) {
            const msg = `reviewGate: validator dispatched without prior reviewer run since the last builder. Adversarial review must precede validation.`;
            if (reviewGate.mode === "reject") {
              api.logger?.warn?.(`pipeline-guard: BLOCK ${msg}`);
              return rejection(msg);
            }
            api.logger?.info?.(`pipeline-guard(log): ${msg}`);
          }
        }

        // -------------------------------------------------------------------
        // Gate 5 — Quality gate (v0.10). The post-builder adversarial-tester
        // pass (Stage 9 BUILD VALIDATION) must come after a code-quality-checker
        // run. Detected as: adversarial-tester dispatched after a builder
        // has run in this orch, but no quality-checker has run since.
        // Stage 5 (TEST-FIRST, before any builder) is unaffected because
        // hasBuilderRun is still false.
        if (
          qualityGate.enabled &&
          targetStage === "adversarial-tester" &&
          !targetIsOrchestrator
        ) {
          const state = getOrInitState(sessionId);
          if (state.hasBuilderRun && !state.qualityCheckerRanSinceLastBuilder) {
            const msg = `qualityGate: adversarial-tester (build-validation) dispatched without prior code-quality-checker run since the last builder. Run Stage 8 (CODE QUALITY) first.`;
            if (qualityGate.mode === "reject") {
              api.logger?.warn?.(`pipeline-guard: BLOCK ${msg}`);
              return rejection(msg);
            }
            api.logger?.info?.(`pipeline-guard(log): ${msg}`);
          }
        }

        // -------------------------------------------------------------------
        // If we rewrote the task (gate 3 only), surface that to the runtime.
        if (rewrittenTask !== undefined) {
          return { params: { ...params, task: rewrittenTask } };
        }
        return;
      } catch (err: any) {
        api.logger?.warn?.(
          `pipeline-guard: before_tool_call handler error: ${err?.message ?? String(err)}`,
        );
        return; // fail open
      }
    });

    api.on("after_tool_call", async (event: any, ctx: any) => {
      try {
        if (event?.toolName !== SPAWN_TOOL) return;
        if (event?.error) return; // only advance state on success

        const sessionId: string = ctx?.sessionId ?? ctx?.runId ?? "anon";
        // Only advance state machine for sessions we've tagged as orchestrators.
        // Otherwise we end up tracking Juliet's main (or any other untagged
        // session) that happened to spawn something with stage-skill markers
        // in the task — a false positive when she dispatches the orchestrator
        // (whose own task naturally references stage skills it'll later use).
        if (!orchestratorSessions.has(sessionId)) return;

        const params = (event.params && typeof event.params === "object") ? event.params : {};
        const task = typeof params.task === "string" ? params.task : "";
        const targetIsOrch = detectOrchestratorSkill(task, orchestratorSkill);
        if (targetIsOrch) return; // dispatching the orch itself is a meta-event, no state advance
        const targetStage = detectStageSkill(task, stageBasenames);
        if (!targetStage) return;

        const state = getOrInitState(sessionId);
        const prev = state.stage;

        if (targetStage === "builder") {
          state.stage = "NEEDS_REVIEW";
          state.reviewerRanSinceLastBuilder = false;
          // v0.10: builder dispatched — quality check now required before next adversarial-tester.
          state.hasBuilderRun = true;
          state.qualityCheckerRanSinceLastBuilder = false;
        } else if (targetStage === "adversarial-reviewer") {
          state.stage = "NEEDS_VALIDATE";
          state.reviewerRanSinceLastBuilder = true;
        } else if (targetStage === "validator") {
          state.stage = "IDLE";
          state.reviewerRanSinceLastBuilder = false;
          // v0.14: do NOT tear down worktree here. In the 9-stage pipeline,
          // validator was the final stage and teardown was correct. In the
          // 15-stage pipeline, Stages 13 (PRE-MERGE INTEGRATION) and 14 (SHIP)
          // still operate on the feature worktree — tearing down at validator
          // strands them. Teardown moved to post-merge-validator branch below.
        } else if (targetStage === "post-merge-validator") {
          // v0.14: pipeline truly complete only after post-merge verify passes.
          // This is the right place to tear down the feature worktree.
          if (state.worktreePath) {
            api.logger?.info?.(
              `pipeline-guard: post-merge-verify complete, removing worktree ${state.worktreePath}`,
            );
            teardownWorktree(repoRoot, state.worktreePath);
            state.worktreePath = undefined;
            state.branch = undefined;
            persistTags();
          }
        } else if (targetStage === "spec-reviewer") {
          // v0.10: sticky flag for the orch's lifetime.
          state.specReviewerRan = true;
        } else if (targetStage === "system-architect") {
          state.systemArchitectRan = true;
        } else if (targetStage === "architecture-reviewer") {
          state.architectureReviewerRan = true;
        } else if (targetStage === "code-quality-checker") {
          state.qualityCheckerRanSinceLastBuilder = true;
        }
        // integration-validator and post-merge-validator advance only the
        // updatedAt timestamp; they don't toggle gate flags.

        state.updatedAt = Date.now();
        persistTags();
        if (prev !== state.stage) {
          api.logger?.info?.(
            `pipeline-guard: session=${sessionId.slice(0, 8)} stage ${prev} → ${state.stage} (after ${targetStage})`,
          );
          emitStatus(api, `transition:${sessionId.slice(0, 8)}:${prev}->${state.stage}`);
        }
      } catch (err: any) {
        api.logger?.warn?.(
          `pipeline-guard: after_tool_call handler error: ${err?.message ?? String(err)}`,
        );
      }
    });
  },
};
