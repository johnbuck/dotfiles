---
name: pnk-secrets
description: Use whenever a password, API key, token, secret, or login is involved: "add my key", "connect to the API", "set up credentials", "here's my token", "it needs a login". Also load it if a secret may have leaked. Keeps keys out of code, git, and screen output.
---

# Never let a secret leak

A secret is any password, API key, token, or login. Treat every one as something
that should never appear in code, in git, or printed on screen.

## 1. Keep keys in a .env file, not in code

Put secrets in a `.env` file in the project folder, and read them from there at
runtime. Never paste a key directly into the source code. The `.env` file holds the
real values; the code just reads them by name.

## 2. Keep .env out of git

The `.env` file should always be listed in `.gitignore` so it is never committed.
What you commit instead is a `.env.example` that shows the setting names with blank
or fake values, so someone knows what to fill in. Ship the example, never the real
one.

## 3. Never print a secret to the screen

Do not run commands that dump a secret into view. A key printed to the terminal is
already leaked. So:

- Do not `cat`, `grep`, `head`, or `less` a `.env` or credential file to see its values.
- Do not run a bare `printenv` or `env`, which prints every variable including injected keys.
- To check a name exists without seeing the value: `grep -q '^NAME=' .env` (presence) or `awk -F= '{print $1}' .env` (just the names).

## 4. If a secret leaks, treat it as compromised

If a key ever reaches the screen, a commit, or a log, it is compromised and cannot
be un-leaked. Tell the operator plainly, in the moment, and with the `question`
tool ask them to rotate it (generate a fresh key at the provider and revoke the old
one). Do not try to quietly scrub it and move on.

## 5. Never commit or push a secret

A key committed and pushed to a shared or public place cannot be pulled back. Before
any commit, make sure no real secret is in the change. If you are unsure, stop and
ask.
