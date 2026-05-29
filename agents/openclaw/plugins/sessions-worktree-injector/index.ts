// sessions-worktree-injector
//
// Rewrites sessions_spawn task strings so each subagent works in its own
// git worktree instead of sharing the parent's checkout. Concurrent
// builders on different branches stop clobbering each other's HEAD.
//
// Modes (configured via openclaw.json plugin config):
//   off      — disabled (no listener registered)
//   log      — detect + log only, never rewrite (default for first deploy)
//   rewrite  — rewrite the task string to do `git worktree add` instead
//              of `git checkout` (target mode)
//
// Detection heuristic: scans the task string for `git checkout feat/<name>`.
// Limited to feat/ prefix on purpose — main/master/origin handling is
// intentionally not in scope.
//
// Cleanup is OUT of scope for this plugin. Pair with a cron that runs
//   git -C <repoRoot> worktree prune --expire=1d
// against the repo, or worktrees will accumulate under worktreeBase.
//
// Failure policy: before_tool_call is fail-closed by contract. Wrap
// everything in try/catch and return undefined on errors so a buggy
// rewrite never blocks a real spawn.

const SPAWN_TOOL = "sessions_spawn";
const DEFAULT_MODE = "log";
const DEFAULT_REPO_ROOT = "/app/repo";
const DEFAULT_WORKTREE_BASE = "/tmp/openclaw-worktrees";

// Only matches feat/<name>. Conservative on purpose.
const CHECKOUT_RE = /git checkout\s+(feat\/[\w./-]+)/g;
const FIRST_BRANCH_RE = /git checkout\s+(feat\/[\w./-]+)/;

function slugifyBranch(branch) {
  return branch.replace(/[^\w-]+/g, "-").slice(0, 64);
}

function buildPreamble(branch, sessionTag, repoRoot, worktreeBase) {
  const slug = slugifyBranch(branch);
  const wtPath = `${worktreeBase}/${slug}-${sessionTag}`;
  return [
    `# sessions-worktree-injector: isolated checkout for ${branch}`,
    `mkdir -p ${worktreeBase}`,
    `cd ${repoRoot}`,
    `git worktree add --force ${wtPath} ${branch}`,
    `cd ${wtPath}`,
    `# All work for this task happens in ${wtPath}.`,
    `# The parent's checkout is untouched; concurrent siblings get their own worktrees.`,
  ].join("\n");
}

export default {
  id: "sessions-worktree-injector",
  name: "Sessions Worktree Injector",
  description:
    "Per-subagent git worktrees for sessions_spawn dispatches. Prevents concurrent-edit clobbers on shared checkouts.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: {
        type: "string",
        enum: ["off", "log", "rewrite"],
        default: DEFAULT_MODE,
      },
      repoRoot: { type: "string", default: DEFAULT_REPO_ROOT },
      worktreeBase: { type: "string", default: DEFAULT_WORKTREE_BASE },
    },
  },
  register(api) {
    const config = api.config ?? {};
    const mode = typeof config.mode === "string" ? config.mode : DEFAULT_MODE;
    const repoRoot =
      typeof config.repoRoot === "string" ? config.repoRoot : DEFAULT_REPO_ROOT;
    const worktreeBase =
      typeof config.worktreeBase === "string"
        ? config.worktreeBase
        : DEFAULT_WORKTREE_BASE;

    if (mode === "off") {
      api.logger?.info?.("sessions-worktree-injector: mode=off (disabled)");
      return;
    }

    api.on("before_tool_call", async (event, ctx) => {
      try {
        if (event?.toolName !== SPAWN_TOOL) return;

        const params =
          event.params && typeof event.params === "object" ? event.params : {};
        const task = params.task;
        if (typeof task !== "string" || !task) {
          api.logger?.debug?.(
            "sessions-worktree-injector: spawn with no task string, passing through",
          );
          return;
        }

        const branchMatch = task.match(FIRST_BRANCH_RE);
        if (!branchMatch) {
          api.logger?.debug?.(
            "sessions-worktree-injector: spawn task has no feat/ checkout, passing through",
          );
          return;
        }
        const branch = branchMatch[1];

        if (mode === "log") {
          api.logger?.info?.(
            `sessions-worktree-injector(log): would rewrite spawn — branch=${branch} taskLen=${task.length}`,
          );
          return;
        }

        // mode === "rewrite"
        const rawTag =
          ctx?.sessionId ?? ctx?.runId ?? `t${Date.now()}`;
        const sessionTag = String(rawTag).replace(/[^\w-]/g, "").slice(0, 8);
        const preamble = buildPreamble(
          branch,
          sessionTag,
          repoRoot,
          worktreeBase,
        );
        const cleanedTask = task.replace(
          CHECKOUT_RE,
          "# (sessions-worktree-injector replaced this checkout with worktree setup above)",
        );
        const newTask = `${preamble}\n\n${cleanedTask}`;

        api.logger?.info?.(
          `sessions-worktree-injector(rewrite): branch=${branch} session=${sessionTag} → worktree dispatch`,
        );
        return { params: { ...params, task: newTask } };
      } catch (err) {
        api.logger?.warn?.(
          `sessions-worktree-injector: handler error: ${err?.message ?? String(err)}`,
        );
        return;
      }
    });

    api.logger?.info?.(
      `sessions-worktree-injector v0.1: registered before_tool_call (mode=${mode}, repoRoot=${repoRoot}, worktreeBase=${worktreeBase})`,
    );
  },
};
