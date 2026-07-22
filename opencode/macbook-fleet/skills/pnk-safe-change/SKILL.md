---
name: pnk-safe-change
description: Use whenever a change could lose work or is hard to undo: "delete", "remove", "reset", "overwrite", "start over", "clean this up", "drop the database", or a big rewrite. Also load it to keep changes reversible so a mistake is easy to walk back.
---

# Keep every change reversible

Most work here is git-tracked and backed up, so a mistake should be easy to undo.
Keep it that way.

## 1. Commit each logical change on its own

Commit one change at a time, with a short clear message that says what it does.
Do not pile several unrelated changes into one big commit. Small commits are the
durable, reviewable record and make it easy to walk back exactly one thing. The
operator can also type `/commit` to stage and commit the current change.

## 2. Checkpoint before anything risky

Before a change that could break a lot or is hard to reverse (a big rewrite, a
rename across many files, a migration), commit the current working state first as a
checkpoint. Then if the risky change goes wrong, you can return to a known-good
point.

## 3. Use /undo for a fast in-session roll back

opencode saves a snapshot of every file change automatically. To quickly undo a
change within the session, the operator can type `/undo` (and `/redo` to put it
back). This is the fast undo. Commits are the durable backup. Both matter; neither
replaces the other.

## 4. Ask in plain words before destroying data

Before deleting or overwriting anything the operator would care about (their
files, real data, a database, existing work) stop and ask with the `question` tool
first. Data changes should be additive and reversible by default, never a silent
destroy.

## 5. Name what could be lost

When you ask, say plainly what would go away and whether it can be recovered. For
example: "This would erase the 40 records you added today, and there is no undo for
it. Should I go ahead?" Let the operator decide.
