---
name: pnk-ship-check
description: Use before telling the operator something is done, ready, working, finished, or fixed. Also when they say "ship it", "is it working?", "did that work?", or "check it before you call it done". Verify by actually running it, not by assuming.
---

# Verify before you say it works

Do not claim something works until you have watched it work. Assumptions are not
proof.

## 1. Actually run it and watch it work

Start the thing and exercise the real path the operator cares about. For a web app,
open it and drive the actual feature. For an API, call the endpoint and read the
response. For a script, run it on real input. Seeing the code compile is not the same
as seeing it work.

## 2. Confirm the quality gates pass

Run the full gates from the house preferences and make them green:

- Python: `pytest` (tests pass), `ruff` (lint and format clean), `mypy` (types check).
- Frontend: `eslint` (lint clean), `prettier` (format clean), `tsc` / TypeScript (types check), and `vitest` if there are tests.

If a gate fails, the work is not done. Fix it.

A test runner that passes with zero tests is not a pass. Every project should have at least one
real test that exercises the main path. If there are none, that is a gap: write one and make it
green before you call the work done.

## 3. Fix the real cause, not the symptom

When something breaks, find why it broke and fix that. Do not silence a test,
comment out a check, delete a failing case, or paper over an error to make the red
go away. A hidden problem is worse than a visible one.

## 4. Leave it runnable

When you finish, the project should start cleanly with `docker compose up` (or Expo
for mobile) with no manual patching. Confirm the commit history reflects what you
did.

## 5. Say what you verified, in plain words

Tell the operator what you ran, what you saw, and how they can check it themselves.
See the `pnk-explain` skill for how to phrase that.
