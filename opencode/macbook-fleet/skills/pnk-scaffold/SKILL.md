---
name: pnk-scaffold
description: Use this skill to turn a spec (or a plain idea) into a working, runnable project skeleton. Triggers when the operator wants to "scaffold a project", "set up the project", "set up a new project", "bootstrap the app", "initialize the codebase", "create the project structure", or is ready to start building a NEW project. Produces a self-contained, portable project (git, framework wired, one passing test, lint and format, its own Dockerfile and compose) that runs day-to-day in the shared workbench. For an existing project, add features against its structure instead. For specs and the roadmap, see pnk-spec and pnk-roadmap.
---

# pnk-scaffold: spec (or idea) to a working, portable skeleton

This skill sets up a **new** project as a clean, runnable skeleton: the chosen stack wired up, a
test harness with at least one passing test, lint and format configured, and everything the project
needs to run anywhere. It is for greenfield only; for an existing project, add features against
what is already there.

The result is a project you can run and test right away, that is also portable: someone could copy
the folder to another machine, run `docker compose up`, and it would work.

There is one path here, and it is required for every project no matter how small. A static page or a
tiny game is built and run exactly the same way as a full app: its own Dockerfile and compose file,
run in the shared workbench. Do not skip the Dockerfile or the compose file, do not run it on the
host, do not just open a file in a browser. Simplicity is about the code, never about the setup.

## You are steering a nontechnical operator

The house preferences (`pnk-preferences.yaml`) are already in your context this session, delivered
through opencode's `instructions` array. Take the stack, the database, and the quality tools from
it. **Do not ask the operator to confirm the stack or any other technical detail.** The one rule:
if the operator, or a spec they wrote, stated a preference (like "use SQLite"), honor it; otherwise
use the preferences. If the project fits none of the named app types, map it to the nearest one, or
ask the admin. Never free-pick a stack on your own.

## Read the plan first

Look for the backlog spec(s) in `backlog/` and the `ROADMAP.md`.
- **If a spec exists:** read it. Take the stack, database, and deployment from it (and from the
  house preferences), and build against it. Do not re-interview.
- **If no spec exists:** for anything non-trivial, suggest running pnk-spec first. If the operator
  just wants to get going, scaffold from the house preferences and their plain description of what
  it is; do not ask technical questions to do it.

## Standing rules (these match the house guardrails)

- **Git from the first change.** Initialize the repo and make the first commit before writing much
  code; add a `.gitignore` for the stack that always ignores `.env`.
- **Secrets never committed.** Ship a `.env.example` listing the settings the project needs; never
  a real `.env`.
- **Quality gates from line one.** The linter, formatter, and type checker from the house
  preferences are configured, not optional.
- **One passing test, always.** Every scaffold ships at least one real test that exercises the
  main path, and it passes. This is a required step, not a nice-to-have: a project with zero tests
  is not scaffolded. Do not report the skeleton done until a test file exists and runs green.

## Build it self-contained and portable

Every project ships everything it needs to run on its own, so it is never glued to this machine:
- **Its own `Dockerfile`.**
- **A standalone `docker-compose.yml`** that brings up the app, plus its own database service when
  the project uses Postgres. A small project on SQLite needs no database service.
- **A `.env.example`** with the settings it needs, including `DATABASE_URL`. In the workbench that
  URL points at the shared Postgres; standalone, the project's own compose brings up its own
  database. Same code, just a different setting.
- **A short plain `README`** saying what it is and how to run it anywhere (the run-anywhere
  instructions: copy the folder or clone it, then `docker compose up`).
- **Pinned dependency manifests** (`requirements.txt` / `pyproject.toml` / `package.json`). Vet
  every dependency before adding it (the real package, a known maintainer, no known vulnerabilities).

## Where it lives and how it runs day-to-day

- The project is a folder at **`~/projects/<name>/`** with its own `.venv` or `node_modules`, so
  different projects can use different library versions without clashing.
- **Daily development runs in the one shared workbench** at `~/workbench`, not a new container per
  project. Run a project's commands by stepping into the workbench, for example
  `docker compose -f ~/workbench/docker-compose.yml exec workbench <command>`. Nothing gets
  installed bare on the host.
- **Do not spin up a per-project container stack for normal development.** The project's own compose
  is for portability and for proving it runs standalone, not for daily dev. A project gets its own
  always-on dedicated compose only when it genuinely needs isolated services, which should be rare.
- **Mobile projects use Expo, not Docker.**

## Confirm before writing into a non-empty directory

If the target folder already has files in it, stop and ask with the `question` tool before writing
anything, naming what is there. Do not overwrite existing work.

## Generate the skeleton

Driven by the spec and the house preferences:
- **Directory structure** appropriate to the stack.
- **Framework wired** to a minimal running "hello world" (the chosen backend or frontend actually
  boots).
- **Test harness** with at least one passing test, and the test command written down. Writing
  this test is a required step: do not skip it or leave it for later.
- **Lint, format, and type-check** configs for the stack.
- **The portable pieces** above (Dockerfile, standalone compose, `.env.example`, README).
- **Remove generator cruft.** If a scaffolding tool (for example `create-expo-app`) drops its own
  `AGENTS.md` or `CLAUDE.md` into the project folder, delete them. The operator's global steering
  already applies, and a stray project-level one silently overrides it.

## After scaffolding

1. **Prove it runs standalone once.** Build and run the project on its own `docker-compose.yml`,
   confirm it comes up and the one test passes, then tear that down. If there is no test yet, stop
   and write one before continuing: a scaffold with no passing test is not finished.
2. **Then set it up for daily dev in the workbench:** its `.venv` or `node_modules` in the project
   folder, `DATABASE_URL` pointing at the shared Postgres (or a SQLite file in the folder), and
   confirm the same one test passes there.
3. **Initialize git and make the first commit** (if not already done).
4. **Report in plain language** what was set up and the exact commands to run it, test it, and lint
   it, both the standalone way and the workbench way. For any technical choice you made from the
   preferences rather than from something the operator said, name it plainly so they can catch a
   wrong one.
5. Offer the next step: hand the first spec to the operator, or a later Claude Code session, to
   build the first real feature. There is no automated build handoff on this machine.
