# Context-leak vectors + verifying without exposure

The full catalog behind SKILL.md's never-do list. "Context" is anything a human or model can later
read: the chat transcript, tool results, terminal stdout/scrollback, shell history, process arguments
(`ps`, `ps auxe`, `/proc/<pid>/cmdline`), log files, and error/exception messages. A secret value in
any of these is compromised at the moment it lands — there is no clean-up, only rotation.

## What leaks, and the safe alternative

| Action that leaks | Why | Safe alternative |
|---|---|---|
| `cat`/`head`/`tail`/`less`/`bat` a `.env` or key file | Prints values | `awk -F= '{print $1}' f.env \| sort` (names), `wc -l f.env` (count) |
| `grep -r <anything>` across a tree containing secret files | May echo matching value lines | Grep names only, or exclude secret files; never grep for the value |
| `echo "$SECRET"`, `printf "%s" "$SECRET"` to stdout | Prints value | Pipe into the consumer; if you must, send to a chmod-600 file |
| `printenv` / `env` / `export -p` | Dumps all env incl. secrets | `printenv NAME \| wc -c` (length only) |
| `docker exec <c> env` / `docker inspect <c>` | Container env + config carry secrets | `docker exec <c> sh -c 'printenv NAME \| wc -c'` |
| `set -x` / `bash -x` around a secret command | Traces every arg, incl. the value | Never trace auth/secret flows; use controlled output |
| Secret in argv: `--value "$S"`, `-d "{\"k\":\"$S\"}"`, `--password "$S"` | argv is world-readable via `ps` and saved to history | Pass via **stdin** or `-d @file` / `--file=file` (chmod 600) |
| Reading *another* process: `ps aux`/`ps -ef`/`pgrep -a`/`cat /proc/<pid>/environ` | Prints other processes' argv/env, which may hold an injected `--token=`/`--password=`/key | Liveness with no args: `pgrep NAME`, `pgrep -l`, `pidof`, `docker ps`, `ps -o pid,stat,comm` |
| `curl …/secrets/raw …` without piping | Response body is plaintext secrets | Pipe to `jq` extracting only what's needed, into a file/var |
| Pasting a secret into a chat message / tool result to "move it" | It's now in the transcript forever | 600 tempfile + `scp` + `shred -u` on every hop |
| Committing a `.env` / token | Lives in git history even if deleted | `.gitignore` + a pre-commit secret scanner (gitleaks/grep) |
| Re-displaying a config/flow that echoes stored secrets (e.g. a settings dump) | Stored values come back as field defaults | Redact credential fields before showing any config dump |

## Capturing a value you legitimately need (rare)

Sometimes a value must briefly live in a shell variable (e.g. a bearer token to pass to the next
call). Rules:

- Capture into a variable with command substitution that does **not** also print:
  `TOKEN=$(some-cmd … 2>/dev/null)` — redirect stderr so a banner/error can't carry it.
- Never `echo` it to confirm. Confirm by length: `printf '%s' "$TOKEN" | wc -c`.
- Keep its lifetime short; unset it when done. Do not write it into a file that gets committed or
  synced.
- To move it across hosts: `umask 077`; write to a tempfile; `scp`; consume; `shred -u` on **both**
  ends. For git auth, use a `GIT_ASKPASS` script that reads the 600 file so the token never enters the
  remote URL or argv.

## Verifying without exposure — the toolkit

- **Parity of two env files:** compare key sets, not values.
  `diff <(awk -F= '{print $1}' a.env | sort) <(awk -F= '{print $1}' b.env | sort)`
- **Presence:** `grep -q '^NAME=' file.env && echo present`
- **Length / shape:** `grep '^NAME=' file.env | cut -d= -f2- | wc -c` (lands a number, not the value).
- **In a container:** `docker exec <c> sh -c 'printenv NAME | wc -c'`.
- **A secret-bearing API response:** `jq -e '.secrets | length'` (count), or extract one field to a
  file — never print the array.

## If you leak anyway

1. Stop the action.
2. Tell the user plainly what value(s) reached context and where.
3. Treat each as compromised → it must be **rotated** (reissued), not just deleted from view.
4. Rotate internal/self-issued tokens end-to-end (reissue → update every consumer → restart/recreate);
   for third-party keys (cloud provider API keys), the owner reissues at the provider.
5. Record the incident so the rotation isn't forgotten.
