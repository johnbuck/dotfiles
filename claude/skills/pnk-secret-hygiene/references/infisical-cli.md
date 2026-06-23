# Infisical CLI — safe usage

Reference for the `infisical` CLI. Assume a **self-hosted** instance: every command needs the endpoint
(`--domain "$INFISICAL_API_URL"`, where that resolves to `<your-instance>/api`) or `INFISICAL_API_URL`
in the env. Never assume the cloud (`*.infisical.com`). Go's resolver skips mDNS, so `.local`
hostnames fail — use a real DNS name or IP.

## 1. Authenticate (machine identity / Universal Auth)

```bash
# Prefer credentials via env (keeps the client-secret out of argv):
export INFISICAL_UNIVERSAL_AUTH_CLIENT_ID=<id>
export INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET=<secret>

INFISICAL_TOKEN=$(infisical login --method=universal-auth \
  --domain="$INFISICAL_API_URL" --plain --silent 2>/dev/null)
```

- `--plain` → prints only the raw JWT (so `$(…)` captures just the token). `--silent` → drops update
  banners. Together they give a clean token capture. **The token is itself a bearer credential** —
  capture it into a variable, never echo it; confirm with `printf '%s' "$INFISICAL_TOKEN" | wc -c`.
- `--method` also supports `user` (interactive), `kubernetes`, `aws-iam`, `gcp-*`, `azure`,
  `oidc-auth`, `jwt-auth`.
- Pass `--token="$INFISICAL_TOKEN"` (or rely on the keyring) on subsequent commands, plus `--domain`.

## 2. Read — prefer injection over retrieval

```bash
# SAFEST: inject secrets as env vars into a child process. Values never hit stdout/argv.
infisical run --projectId=<PID> --env=<ENV_SLUG> --path=<PATH> -- <your-command>
infisical run --command="npm run build && npm start"      # chained shell form
```
`run` flags: `--projectId`, `--env` (slug, default `dev`), `--path` (repeatable), `--token`,
`--recursive`, `--include-imports` (default true), `--expand` (default true), `--secret-overriding`,
`--tags`, `--watch` (dev only), `--domain`.

```bash
# If a value MUST land somewhere, put it in a chmod-600 FILE — never the terminal.
umask 077
infisical export --format=dotenv --output-file=./.env \
  --projectId=<PID> --env=<ENV_SLUG> --path=<PATH> --domain="$INFISICAL_API_URL"
```
- `--output-file` is preferred over `> file`: with shell redirection a token-expiry re-auth prompt
  can't render and the command fails mid-write.
- `--format`: `dotenv` (default), `dotenv-export`, `json`, `yaml`, `csv`.
- Infisical's dotenv output **wraps values in single quotes**; when parsing one value out, strip the
  surrounding quotes or an auth call with that value returns 401.

### CLI read footguns (these print secret values)

| Command | Behavior | Do instead |
|---|---|---|
| `infisical secrets get NAME` | Prints the value | `infisical run -- <cmd>`; or export to a 600 file |
| `infisical secrets` (list) | Prints all values | `... --output-file` then `awk -F= '{print $1}'` for names |
| `infisical export` **without** `--output-file`/redirect | Dumps all values to stdout | always `--output-file` |
| any of the above with `--plain` | Cleaner, easier-to-scrape values — **worse** leak | avoid |
| trusting `--silent` to hide values | `--silent` only mutes banners/tips, **not** values | redirect/inject instead |

## 3. Write — value via file/stdin, stdout muted

```bash
# Bulk from a chmod-600 dotenv. Export the token (the CLI reads INFISICAL_TOKEN
# natively) instead of passing --token=… — a flag would put the bearer token in
# argv (ps/history). --domain isn't a credential but env is cleaner too.
export INFISICAL_TOKEN INFISICAL_API_URL
infisical secrets set --file=./pairs.env \
  --projectId=<PID> --env=<ENV_SLUG> --path=<PATH> >/dev/null 2>&1

# Single value via stdin (use the bundled helper): scripts/infisical-set-stdin.sh
```
- **Always `>/dev/null 2>&1`** on `set`: some CLI versions echo a confirmation table containing the
  value. `--silent` does not suppress it. Verify afterward by name + length only.
- `set` flags: `--env`, `--path`, `--type` (`shared` default | `personal`), `--tag`, `--file`,
  `--projectId`, `--token`, `--domain`.
- **Avoid `NAME=@/path/to/file`.** Its meaning differs across versions — older self-hosted CLIs store
  the literal string `@/path/to/file` as the value (exit 0, no warning). Use `--file=<dotenv>` for
  bulk or stdin for a single value.
- **Never** `infisical secrets set NAME --value "$SECRET"` — the value is in argv (`ps` + history).
- `infisical secrets delete NAME … >/dev/null 2>&1`.

## 4. Cross-command flags

`--projectId` (required under machine-identity auth — no inferred workspace), `--env` (slug, not
display name), `--path` (`/`-rooted folder), `--token`, `--recursive`, `--domain`.

## 5. Folders & environments

- Folders: `infisical secrets folders get|create|delete --path=/a/b [--name=foo]`.
- Environments are referenced by **slug** (`dev`, `staging`, `prod`, …), which may not match the
  display name — verify the slug before writing.

## 6. Rotation (general shape)

1. Update the value in Infisical (UI, or `set` from stdin/file with stdout muted).
2. Re-run whatever sync regenerates downstream env files from Infisical.
3. Recreate/restart the consuming services so they pick up the new value.
Do not hand-edit generated env files — they get overwritten on the next sync.
