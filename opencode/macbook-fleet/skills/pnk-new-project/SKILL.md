---
name: pnk-new-project
description: Use when starting anything new: "let's build", "make me an app", "start a new project", "I have an idea", "create a tool", "spin up a website", or the operator describes something they want built from scratch. Sets up a clean, portable project the right way from the first change.
---

# Starting a new project

Follow these steps in order, for every project no matter how small. Keep the code simple, but never
the setup: a static page or a small game gets the same path as a full app, its own Dockerfile and
compose file, run in the shared workbench, never on the host. Do not take a shortcut, do not just
open a file in a browser.

## 1. Make it a git project from the first change

Run `git init` in the new folder before writing any code. Commit the very first
change, and every logical change after that. Nothing should exist only in the
working folder with no commit behind it.

## 2. Pick the stack from the house preferences

The operator should not have to answer technical questions. Read
`~/.config/opencode/skills/pnk-preferences.yaml` and steer toward the standing choices:

- Web app: Python + FastAPI on the back, React + Vite + TypeScript + Tailwind on the front.
- Plain API: Python + FastAPI.
- Mobile app: React Native with Expo (runs with Expo, not Docker).
- Script or small tool: Python (CLI uses Typer).
- Data: start with a SQLite file in the project folder. Move to the shared Postgres only when SQLite is not enough.

If the project fits none of these, default to Python. Only ask with the `question`
tool if a real choice changes what gets built.

## 3. Build it self-contained and portable

Every project ships everything it needs to run anywhere:

- Its own `Dockerfile`.
- A standalone `docker-compose.yml`.
- A `.env.example` showing the settings it needs (never a real `.env`).
- A short plain `README` saying what it is and how to run it.

The test: someone could copy this folder to another computer, run
`docker compose up`, and it would work.

## 4. Run it in the shared workbench, keep the host clean

Daily development happens inside the one shared Docker workbench at `~/workbench`,
not a new container per project. Keep each project's dependencies local to its own
folder under `~/projects/<name>/` (its own `.venv` or `node_modules`) so versions
never clash. Point `DATABASE_URL` at the shared Postgres in the workbench, or at a
SQLite file for a small project.

Do not install packages onto the whole computer. Install inside the project's
environment or its container, never bare on the host.
