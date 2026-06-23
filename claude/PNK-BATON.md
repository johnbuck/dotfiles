# pnk-baton — multi-agent build/review pipeline for Claude Code

`pnk-baton` runs a spec through a deterministic build pipeline driven by specialized
Claude Code subagents, keeping stage work **out of the main session's context**.
It's a Claude Code-native build pipeline: plan → **align (drift gate)** → test-first →
build → integrate base → adversarial review → **accept (drift gate)** → optional validate
→ self-document → auto-merge.

## Files (and where `install.sh` puts them)

pnk-baton is spread across the four directories Claude Code reads each kind of config from:

| In this repo (`claude/`) | Installs to | What it is |
|---|---|---|
| `agents/pnk-baton-*.md` | `~/.claude/agents/` | The 9 stage subagents |
| `workflows/pnk-baton.js` | `~/.claude/workflows/` | The orchestration script |
| `commands/pnk-baton.md` | `~/.claude/commands/` | The `/pnk-baton` slash command |
| `hooks/pnk-baton-guard.sh` | `~/.claude/hooks/` | Optional feature-branch guard (opt-in per repo) |

`claude/install.sh` copies all four into `~/.claude/` (backing up anything
it overwrites). After install, restart Claude Code so it registers the agents,
workflow, and command.

## How it works

`/pnk-baton <spec> [--validate] [--base <branch>] [--ssh <user@host>] [--worktree <path>] [--require-roadmap] [--north-star <path>] [--roadmap <path>]`
invokes the `pnk-baton` workflow, which orchestrates the agents below as a single
deterministic script. Each run gets its **own git worktree** (so several `/pnk-baton`
runs are safe concurrently), and stage results live in script variables, never the main
session context.

```
setup (worktree) → planner → drift-checker (ALIGN, pre-build) → test-author (red) → builder (green) → integrate base → reviewer ×N (parallel)
                       ↑_______________________________ retry on REJECT _______________________________|
       → drift-checker (ACCEPT, post-build UAT) → [optional] validator → document (as-built) → merge (ff, local) → report
```

| Agent | Role | Writes? |
|---|---|---|
| `pnk-baton-planner` | spec → testable design + success criteria | no (read-only) |
| `pnk-baton-drift-checker` | alignment gate — work vs North Star / principles / spec / roadmap; pre-build + post-build UAT | no (read-only) |
| `pnk-baton-test-author` | failing tests that define the contract | tests only |
| `pnk-baton-builder` | the single writer — make tests pass | prod code |
| `pnk-baton-integrator` | create the run's worktree; merge latest base in before review | merge commit only |
| `pnk-baton-reviewer` | independent, diff-only, adversarial (one dimension each) | no (read-only) |
| `pnk-baton-validator` *(optional)* | real-infra end-to-end judgment | no (read-only) |
| `pnk-baton-documenter` | append an as-built / lessons section to the spec | spec/doc only |
| `pnk-baton-merger` | fast-forward base to the branch (local only, never pushes) | base ref only |

## Remote targets (`--ssh`)

By default everything runs on the local machine. When the repo + its test harness live
on another host, pass `--ssh <user@host>` (e.g. `--ssh user@host`). Then
**every stage operates on the repo on that host over ssh** — `repo`, `base`, `branch`,
`spec`, and the worktree are all paths/refs ON the remote; nothing is copied locally.
The workflow injects a "REMOTE TARGET" preamble into every agent prompt telling it to:
run all git/file/test commands as `ssh <host> '…'` (quoting the whole command so
pipes/`&&`/redirects run remotely), read remote files with `ssh <host> 'cat …'`, write by
piping a local temp back (`ssh <host> 'cat > path' < /tmp/x`), and use `ssh <host> bash -lc`
/ `bash -s` for any bash syntax (the remote login shell may be fish). The planner carries
`Bash` specifically so it can `ssh`-read the remote tree (it stays read-only).

Pair it with `--worktree <path>` when the remote test harness only sees a fixed location
— e.g. a containerised test gate that mounts the repo: put the worktree **under** the repo
(`--worktree <repo>/worktrees/pnk-baton-<slug>`) so the container sees it, and have the
test-author's run command target that path. Without this, the worktree defaults to a
sibling `.pnk-baton-worktrees/` dir the container can't see.

## Where specs and roadmaps come from — the `pnk-plan` plugin

pnk-baton is the **consumer** half of a producer→consumer pair. The **`pnk-plan`** plugin
(local plugin: skills `pnk-spec`, `pnk-roadmap`, `pnk-scaffold`) is the interactive **producer**
that writes the spec + roadmap artifacts pnk-baton builds and its drift-checker enforces:

- **`pnk-spec`** — interview → one clear backlog spec in `backlog/` (the file you pass to
  `/pnk-baton`). Testable acceptance criteria become baton's contract.
- **`pnk-roadmap`** — create + maintain the living `ROADMAP.md` (also the epic index) that the
  drift-checker auto-discovers.
- **`pnk-scaffold`** — greenfield project skeleton, then hand the first spec to pnk-baton.

These are **skills, not a workflow**: spec/roadmap work is an interactive interview, which a
headless workflow can't do. The handoff is bidirectional via the main session — the skills offer
to kick off `/pnk-baton`, and baton's `ROADMAP-MISSING`/`DRIFT` outcomes point back to the
skills. (`pnk-plan` replaced the old imported `do-the-thing` plugin on 2026-06-17.)

## Drift / alignment gates

`pnk-baton-drift-checker` is an **independent alignment auditor** — separate from the
adversarial reviewers (who hunt bugs in the diff). It asks one question: *does this work
still serve what the project is trying to be?* It runs twice:

- **Align (pre-build)** — after the planner, before any code. Cheap. Catches drift before
  build tokens are spent: is this spec on the roadmap, does the plan honor the North Star
  and the project's principles, has scope crept past what was asked?
- **Accept (post-build)** — after the reviewers PASS, before merge. User-acceptance-style:
  reads the actual diff and confirms the *shipped* result still maps to a roadmap item and
  hasn't drifted from the spec/plan during construction.

It audits five axes: **project-north-star** (the project's vision doc), **baton-principles**
(baton's fixed engineering constitution — simplicity, surgical changes, no silent scope
change; **data stewardship**: data is additive/reversible/never silently destroyed, no
destructive action without full context + operator permission, state the blast radius first,
migrations ship a rollback, backups verified-restorable, bounded retention, validate on staging
first; **DRY** one parameterized entry point per concern; **supply-chain** vetting of every new
dependency),
**how-we-do-things** (the repo's own AGENTS.md/CLAUDE.md coding + forbidden-action rules,
read at runtime), **spec** (the task at hand), and **roadmap** (the canonical plan).

**Artifacts** are auto-discovered (`NORTH-STAR.md`/`VISION.md`/a North Star section in
AGENTS.md·CLAUDE.md·README; `ROADMAP.md`/backlog index/epics doc/spec frontmatter) or set
explicitly with `--north-star <path>` / `--roadmap <path>`.

**Both gates block.** A genuine **Critical/High/Medium** misalignment returns `DRIFT-HALT`
(pre-build, nothing built) or `DRIFT-BLOCKED` (post-build, branch built+reviewed but **not
merged**, left for the operator). Calibration is **neutral with mandatory evidence**: every
blocking finding must cite the exact violated intent (file/section + quote) or it's downgraded
to Optional — so the gate blocks on cited rule-violations, never on vibes, and the threshold is
enforced in the workflow code (`isDrift`/`blockingFindings`), not just the prompt. A correct,
minimal, on-roadmap change is `ALIGNED`.

**Missing roadmap** is configurable: by default it's reported as a warning and the run
continues; pass `--require-roadmap` to make it a hard `ROADMAP-MISSING` failure.

## Design principles

- **Single writer.** Only `pnk-baton-builder` writes production code — no parallel
  writers making conflicting implicit decisions.
- **author ≠ reviewer.** The reviewer sees only the diff, not the reasoning.
- **author ≠ test-author.** Tests are written in a different context so the
  implementation can't be quietly written to match them.
- **One worktree per run, not per agent.** Agents within a run share that run's
  worktree (`.pnk-baton-worktrees/<branch>`, a sibling of the repo); each *run* gets
  its own, so concurrent `/pnk-baton` runs never collide. Cleaned up on a successful merge.
- **Gates are code**, not prompts — skipping a stage is impossible.
- **Alignment is gated, not assumed.** An independent drift-checker validates the work
  against the project's North Star, the roadmap, the spec, and the engineering principles —
  before building (pre-build) and before shipping (post-build UAT). Bugs are the reviewer's
  job; *direction* is the drift-checker's.
- **Base is integrated before review.** The base branch moves during a run; the
  integrator merges it in (`--no-ff`, no rebase) so the review diff stays clean and
  the branch stays mergeable.
- **Auto-merge, local only.** When every gate is green, pnk-baton fast-forwards base to
  the branch (default on; `merge: false` to disable). It **never pushes** — that
  stays your call. If ff is refused it reports `NOT_FF` and never forces.
- **Documents itself.** On completion the documenter appends an as-built record
  (what changed, decisions, lessons, how to verify) to the spec, committed on the
  branch so it lands with the merge.

## Gotcha: `args` arrives as a JSON string

This runtime delivers the workflow `args` input to the script as a **JSON string**,
not a parsed object — `pnk-baton.js` parses it defensively
(`typeof args === 'string' ? JSON.parse(args) : args`). Don't revert that to
`args.spec` or invocation breaks silently.

## Gotcha: invoking by `name` uses a turn-start snapshot

Invoking the workflow by `name: "pnk-baton"` (what `/pnk-baton` does) resolves to the copy
registered at the **start of the current turn** — custom agents register at turn
boundaries too. So when *iterating on pnk-baton itself mid-session*, launch the live
file with `scriptPath: ~/.claude/workflows/pnk-baton.js` instead, or your edits (and any
newly-added `pnk-baton-*` agents) won't take effect until the next turn. For normal use,
`name` is fine.

## The guard hook (optional)

`hooks/pnk-baton-guard.sh` is a `PreToolUse(Bash)` guard that enforces feature-branch
discipline (denies commits to main/master and force-pushes to them). Install it
**per consumer code-repo** (not user-global — some repos commit straight to main).
In that repo's `.claude/settings.json`:

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash",
    "hooks": [ { "type": "command",
      "command": "$HOME/.claude/hooks/pnk-baton-guard.sh" } ] } ] } }
```
