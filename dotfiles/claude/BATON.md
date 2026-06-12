# baton — multi-agent build/review pipeline for Claude Code

`baton` runs a spec through a deterministic build pipeline driven by specialized
Claude Code subagents, keeping stage work **out of the main session's context**.
It's a Claude Code-native build pipeline: plan → test-first → build → integrate
base → adversarial review → optional validate → self-document → auto-merge.

## Files (and where `install.sh` puts them)

baton is spread across the four directories Claude Code reads each kind of config from:

| In this repo (`dotfiles/claude/`) | Installs to | What it is |
|---|---|---|
| `agents/baton-*.md` | `~/.claude/agents/` | The 8 stage subagents |
| `workflows/baton.js` | `~/.claude/workflows/` | The orchestration script |
| `commands/baton.md` | `~/.claude/commands/` | The `/baton` slash command |
| `hooks/baton-guard.sh` | `~/.claude/hooks/` | Optional feature-branch guard (opt-in per repo) |

`dotfiles/claude/install.sh` copies all four into `~/.claude/` (backing up anything
it overwrites). After install, restart Claude Code so it registers the agents,
workflow, and command.

## How it works

`/baton <spec> [--validate] [--base <branch>]` invokes the `baton` workflow, which
orchestrates the agents below as a single deterministic script. Each run gets its
**own git worktree** (so several `/baton` runs are safe concurrently), and stage
results live in script variables, never the main session context.

```
setup (worktree) → planner → test-author (red) → builder (green) → integrate base → reviewer ×N (parallel)
                       ↑___________________ retry on REJECT ___________________|
                                  → [optional] validator → document (as-built) → merge (ff, local) → report
```

| Agent | Role | Writes? |
|---|---|---|
| `baton-planner` | spec → testable design + success criteria | no (read-only) |
| `baton-test-author` | failing tests that define the contract | tests only |
| `baton-builder` | the single writer — make tests pass | prod code |
| `baton-integrator` | create the run's worktree; merge latest base in before review | merge commit only |
| `baton-reviewer` | independent, diff-only, adversarial (one dimension each) | no (read-only) |
| `baton-validator` *(optional)* | real-infra end-to-end judgment | no (read-only) |
| `baton-documenter` | append an as-built / lessons section to the spec | spec/doc only |
| `baton-merger` | fast-forward base to the branch (local only, never pushes) | base ref only |

## Design principles

- **Single writer.** Only `baton-builder` writes production code — no parallel
  writers making conflicting implicit decisions.
- **author ≠ reviewer.** The reviewer sees only the diff, not the reasoning.
- **author ≠ test-author.** Tests are written in a different context so the
  implementation can't be quietly written to match them.
- **One worktree per run, not per agent.** Agents within a run share that run's
  worktree (`.baton-worktrees/<branch>`, a sibling of the repo); each *run* gets
  its own, so concurrent `/baton` runs never collide. Cleaned up on a successful merge.
- **Gates are code**, not prompts — skipping a stage is impossible.
- **Base is integrated before review.** The base branch moves during a run; the
  integrator merges it in (`--no-ff`, no rebase) so the review diff stays clean and
  the branch stays mergeable.
- **Auto-merge, local only.** When every gate is green, baton fast-forwards base to
  the branch (default on; `merge: false` to disable). It **never pushes** — that
  stays your call. If ff is refused it reports `NOT_FF` and never forces.
- **Documents itself.** On completion the documenter appends an as-built record
  (what changed, decisions, lessons, how to verify) to the spec, committed on the
  branch so it lands with the merge.

## Gotcha: `args` arrives as a JSON string

This runtime delivers the workflow `args` input to the script as a **JSON string**,
not a parsed object — `baton.js` parses it defensively
(`typeof args === 'string' ? JSON.parse(args) : args`). Don't revert that to
`args.spec` or invocation breaks silently.

## Gotcha: invoking by `name` uses a turn-start snapshot

Invoking the workflow by `name: "baton"` (what `/baton` does) resolves to the copy
registered at the **start of the current turn** — custom agents register at turn
boundaries too. So when *iterating on baton itself mid-session*, launch the live
file with `scriptPath: ~/.claude/workflows/baton.js` instead, or your edits (and any
newly-added `baton-*` agents) won't take effect until the next turn. For normal use,
`name` is fine.

## The guard hook (optional)

`hooks/baton-guard.sh` is a `PreToolUse(Bash)` guard that enforces feature-branch
discipline (denies commits to main/master and force-pushes to them). Install it
**per consumer code-repo** (not user-global — some repos commit straight to main).
In that repo's `.claude/settings.json`:

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash",
    "hooks": [ { "type": "command",
      "command": "$HOME/.claude/hooks/baton-guard.sh" } ] } ] } }
```
