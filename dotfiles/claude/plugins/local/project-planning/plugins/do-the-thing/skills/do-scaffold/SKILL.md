---
name: do-scaffold
description: This skill should be used when the user wants to "scaffold a project", "set up the project", "create the project structure", "initialize the codebase", "bootstrap the app", "set up the repo", "do scaffold", or is ready to start coding after planning. Use this skill whenever the user has finished defining requirements and wants to turn a plan into a working project skeleton, even if they don't say "scaffold" explicitly. This skill covers project setup only - for requirements planning, see do-specs.
---

# Scaffold Thing - Project Setup and Initialization

This skill turns a project plan into a working project skeleton with a minimal "hello world" application. It reads existing requirements documents when available, or asks enough questions to scaffold without them.

## Process

### Step 1: Understand What to Build

Check whether `docs/prd-v01.md` and `docs/trd-v01.md` exist in the current directory.

**If both exist:** Read them. The TRD contains the tech stack, directory structure, deployment approach, and dependency list. Use these as the blueprint. Confirm the plan with the user before proceeding - they may have changed their mind about something since the docs were written.

**If only a PRD exists:** Read it. Ask the user about tech stack preferences, then determine the right architecture based on the requirements.

**If neither exists:** Ask discovery questions to determine:
- What is this project? (one sentence)
- What tech stack? (language, framework, database if any)
- Web app, CLI tool, library, API, or something else?
- Any deployment preferences?

Keep it brief. This isn't define-thing - the goal is to get enough context to create the right directory structure and configs, not to write requirements.

### Step 2: Create the Project Skeleton

Build the directory structure specified in the TRD, or determine an appropriate one based on the tech stack. Every project gets:

- **Directory structure** appropriate to the stack
- **Dependency files** (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, etc.)
- **.gitignore** appropriate to the stack (always include .env)
- **Configuration files** the stack requires (tsconfig.json, vite.config.ts, pytest.ini, etc.)
- **Linter and formatter configs** -- every project ships with these configured (ESLint + Prettier for JS/TS, Ruff for Python, etc.)
- **Test configuration and directories** with at least one passing test
- **.env.example** listing required environment variables (never commit actual .env files)

Based on what the TRD or user specifies, the project may also need:
- Dockerfile and docker-compose.yml (if containerized deployment was chosen)
- CI/CD configuration
- Pre-commit hooks for lint/format/type-check

Do not assume Docker. Do not assume any particular deployment model. Build what the project actually needs based on the TRD or the user's stated requirements.

### Step 3: Create a Minimal Working Application

Beyond the skeleton, create the minimum code needed to prove the stack works:

- A root entry point that starts the application
- One working route or command (a health check endpoint, a hello world page, a CLI that prints version info)
- If the project has a frontend and backend, both should be runnable
- At least one unit test that passes (testing the hello world route/command)
- Linter and formatter should pass on all generated code

The goal is "I can start this, run the tests, and run the linter, and everything passes" -- not feature implementation. This gives the user a known-good starting point to build from.

### Step 4: Verify It Works

Run whatever commands confirm the skeleton is valid:
- Dependency installation (inside a container if that's the deployment model, or locally if appropriate)
- Build step if applicable (TypeScript compilation, Vite build, etc.)
- Run the linter and formatter -- all generated code should pass clean
- Run the test suite -- the placeholder test should pass
- Start the application and confirm it responds

If something fails, fix it before moving on. The user should receive a project where the app runs, tests pass, and the linter is clean out of the box.

### Step 5: Git Initialization

Ask the user whether to initialize git and make a first commit. If yes:
- `git init`
- Add all files
- Commit with a descriptive initial commit message

## Constraints

### Dependency sandboxing
Follow the deployment approach specified in the TRD. When the TRD calls for containerized deployment, install dependencies inside containers rather than on the host. When the TRD specifies a simpler approach (static files, system packages, etc.), follow that instead.

The guiding principle is: don't install application-level packages on the host machine unless that's the right approach for this specific project. A Docker-based web app installs inside containers. A simple Python CLI might use a virtual environment. A static site might need nothing installed at all. Match the approach to the project.

### Respect existing decisions
If a TRD exists, follow it. Don't substitute different libraries or change the architecture unless the user asks. The TRD represents decisions already made during planning.

### Keep it minimal
Create the skeleton and hello world. Don't start implementing features - that's the user's next step. Don't add boilerplate comments explaining what each file does. Don't create README.md unless the user asks.
