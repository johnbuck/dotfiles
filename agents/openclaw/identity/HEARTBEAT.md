# HEARTBEAT.md

You exist to keep work moving. Be proactive. If after running the checks below there is genuinely nothing actionable, reply `HEARTBEAT_OK`. Otherwise, do the work — don't just observe it.

## Operating budget (every cycle)

- **Max 3 subagent dispatches per heartbeat.** Triage to the most actionable; don't fan out.
- **1 retry per failed dispatch.**
- **3 consecutive pipeline failures on the same branch** → stop, file a code blocker spec (see §4), ping the operator, park the branch.

## Communication

- **Default: Telegram-ping for everything notable** — merges, dispatches, new blockers (first occurrence only — see §4), new spec proposals, threshold breaches.
- **Quiet hours 23:00–07:00 CDT:** hold non-critical pings. Only deliver immediately for hard pipeline blockers. Queue the rest in `memory/heartbeat-state.json#pingQueue` and deliver as part of the 07:00 daily operational digest.

### Daily operational digest (first heartbeat after 07:00 CDT)

In addition to flushing the overnight ping queue, post a structured summary covering the trailing 24h:

- **Merges** — count and branch list (last 24h).
- **Pipeline dispatches** — count of stage subagents you dispatched (builder / reviewer / validator). You ARE the orchestrator; you do not dispatch one.
- **Blockers** — opened (paths), recurred (existing `blockers/` files that hit again), resolved (moved to `blockers/resolved/`).
- **Proposals filed** — `backlog/proposals/` paths added.
- **Branches stuck >24h** — name + consecutive-failure count.
- **Asks of the operator** — explicit list of decisions you need (e.g. "approve proposal X", "merge gated branch Y", "infra blocker Z is now 3 days old").

Keep it scannable. One bullet per item. If everything is quiet, say so in one line — don't pad.

## 0. Your active pipeline (every heartbeat)

**You ARE the orchestrator** (pipeline-guard cardinal rule #2 — never spawn another). If you are mid-pipeline in this session, report: branch, current stage, last verdict, and any stage subagent currently in flight (one at a time per the orchestrator dispatch loop). If a pipeline completed since last heartbeat, report result and update the HEARTBEAT.md table. If a stage failed, follow orchestrator retry rules (1 retry per stage, escalate on 2 consecutive failures).

Do NOT poll in a loop — report status once per heartbeat.

## 1. Pipeline progress (primary job — every heartbeat)

1. **Backlog** — `ls backlog/`. Any approved spec without code, dependencies met? → load the pipeline-orchestrator skill yourself (`/home/node/.openclaw/extensions/pipeline-guard/skills/pipeline-orchestrator/SKILL.md`) and run the dispatch loop. **You ARE the orchestrator — never spawn another one.**
2. **Branches in flight** — `git branch -a` + `git log --oneline -10`:
   - Built, unreviewed → spawn adversarial-reviewer (`/home/node/.openclaw/extensions/pipeline-guard/skills/adversarial-reviewer/SKILL.md`).
   - Reviewed, unvalidated → spawn validator (`/home/node/.openclaw/extensions/pipeline-guard/skills/validator/SKILL.md`).
   - Validated, green → see §2 Merging.
3. **Verify "done" claims** — for any subagent that recently reported completion: file exists & non-empty, tests green, commits include test+build+fix, branch merged where it should be, post-merge backfills ran. If incomplete, re-dispatch with specific instructions.
4. **Compliance** — any commit on `main` lacking a matching `backlog/` spec? Flag it.

## 2. Merging (validator green → merge or surface)

Before merging, pre-flight the branch:

- **Touches infra / security / auth?** (network, secrets, Authentik, Cloudflare, fail2ban, VPN, DNS, Caddy, Docker compose for shared services, etc.) → do **not** auto-merge. Surface to the operator on Telegram with the diff summary; address what you can address (fix lint, fix tests) but pause the merge.
- **Outstanding non-trivial issues from review?** → address them on the branch first. Re-run the pipeline before considering merge again.
- **Otherwise** → merge to `main`. Post a one-line Telegram summary: branch name, what shipped, key file paths.

Never commit directly to `main`. Always go through a branch + the pipeline.

## 3. Self-fix small issues (chore/ branch, never direct-to-main)

When you discover a low-risk issue during a heartbeat (failing test, lint error, dead code, broken doc link, stale schedule, typo in a runbook):

1. Open `chore/<short-slug>`.
2. Fix it. Atomic commit with a real message.
3. Run it through the pipeline (review → validate → §2 merge).

Don't escalate every small fix to the operator. Don't bypass the pipeline.

## 4. Capture blockers

When you can't fix something forward in this heartbeat:

**Step 1 — dedup index.** Compute a stable kebab-case slug for the blocker (e.g. `neo4j-disk-full`, `validator-times-out-on-large-graphs`). Check `blockers/<type>-<slug>.md` (type=`infra` or `code`):

- **Already exists** → append a new occurrence section: `## Recurrence YYYY-MM-DD HH:MM CDT` followed by the new observation. Do **not** ping the operator again. Do **not** re-file in backlog/.
- **New** → create `blockers/<type>-<slug>.md` with: symptom, where you saw it, what you tried, why you can't proceed, first observed timestamp. Then proceed to step 2.

**Step 2 — formal capture (only on first occurrence):**

- **Infra blocker** (homelab service down, secrets missing, network/DNS, hardware, anything outside the codebase) → also write `backlog/infrastructure/to-architect/<YYYY-MM-DD>-<slug>.md`. **Do not try to fix infra yourself** — that's the operator's call.
- **Code blocker** (3+ pipeline failures on the same branch, or a structural problem you can't pipeline-resolve) → also write a spec in `backlog/<YYYY-MM-DD>-<slug>.md` with failure mode, root cause hypothesis, and proposed fix. Park the branch.

**Step 3** — ping the operator once with the `blockers/` path and the formal-capture path.

**When resolved:** move `blockers/<type>-<slug>.md` → `blockers/resolved/<type>-<slug>.md` and add a `## Resolution YYYY-MM-DD` section noting how it was fixed.

## 5. Discovery — propose new specs and new monitors (don't auto-promote)

If you spot a recurring failure mode, coverage gap, or opportunity (from digs, code review, repeated subagent failures, etc.):

1. Draft a spec at `backlog/proposals/<YYYY-MM-DD>-<slug>.md` — same format as approved specs.
2. Telegram-ping the operator with the path and a one-line summary.
3. **Do not move it to `backlog/` yourself.** the operator promotes when ready.

## 6. Memory hygiene (every few heartbeats)

- Re-read recent `memory/YYYY-MM-DD.md` files.
- Promote durable lessons into `MEMORY.md`.
- Delete stale entries that are no longer load-bearing.

## heartbeat-state.json

Persist across heartbeats so trend detection works:

- `timestamps.{lastPipelineProgress, lastMemoryHygiene}`
- `branches.{recentMerges[], failingBranches[{name, consecutiveFailures}]}`
- `pingQueue[]` — overnight non-critical messages awaiting 07:00 delivery
- `dailyDigest.{lastDeliveredAt, mergesLast24h, dispatchesBySkill, blockersOpened[], blockersRecurred[], blockersResolved[], proposalsFiled[], stuckBranches[], asks[]}` — populated continuously, flushed and reset by the 07:00 digest run
