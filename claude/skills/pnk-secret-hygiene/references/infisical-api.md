# Infisical REST API — safe usage

When the CLI isn't available or you need programmatic CRUD. Self-hosted base URL is
`<your-instance>/api` (the value of `$INFISICAL_API_URL`); substitute it everywhere the docs show
`https://us.infisical.com` / `https://app.infisical.com`.

**The defining hazard:** the raw secrets endpoints return **plaintext** secret values, and the login
endpoint takes a client-secret and returns a bearer token. Any un-piped `curl` to these dumps secrets
or tokens to stdout (→ context). Treat every request/response here as secret-bearing.

## 1. Authenticate (Universal Auth)

```
POST $INFISICAL_API_URL/v1/auth/universal-auth/login
Content-Type: application/json
body: {"clientId": "...", "clientSecret": "...", "organizationSlug": "<optional>"}
→ {"accessToken": "...", "expiresIn": <s>, "accessTokenMaxTTL": <s>, "tokenType": "Bearer"}
```

Safe call — send the body from a chmod-600 file (keeps `clientSecret` out of argv), capture only the
token, never print it:

```bash
umask 077
REQ=$(mktemp)
# Build JSON with jq --arg so values are escaped correctly even if they contain
# ", \, or % (printf would corrupt them and a malformed clientSecret → 401).
jq -n --arg id "$CID" --arg secret "$CSECRET" \
  '{clientId:$id, clientSecret:$secret}' > "$REQ"
TOKEN=$(curl -s -X POST "$INFISICAL_API_URL/v1/auth/universal-auth/login" \
  -H 'Content-Type: application/json' -d @"$REQ" | jq -r '.accessToken')
shred -u "$REQ"
printf '%s' "$TOKEN" | wc -c    # confirm by length, never echo the token
```

- **Never** inline the body as `-d '{"clientSecret":"..."}'` — it lands in argv (`ps`).
- **Never** `bash -x`/`set -x` this flow — tracing prints the secret body.
- All subsequent requests: `Authorization: Bearer $TOKEN`.

## 2. Secrets CRUD (the plaintext-bearing endpoints)

Public docs now show these under **v4** (`/api/v4/secrets`); older self-hosted instances serve the
equivalent **v3 raw** family (`/api/v3/secrets/raw`). Same param shape, same plaintext responses —
check which version your instance serves before hardcoding the path.

| Op | Method + path (v3 raw) | Key params |
|---|---|---|
| List | `GET /v3/secrets/raw` | query: `workspaceId` (= projectId), `environment`, `secretPath` (default `/`), `recursive`, `expandSecretReferences`, `include_imports` |
| Get | `GET /v3/secrets/raw/{name}` | query: `workspaceId`, `environment`, `secretPath`, `type` |
| Create | `POST /v3/secrets/raw/{name}` | body: `workspaceId`/`projectId`, `environment`, `secretPath`, `secretValue`, `type` |
| Update | `PATCH /v3/secrets/raw/{name}` | body: same as create |
| Delete | `DELETE /v3/secrets/raw/{name}` | body: `workspaceId`, `environment`, `secretPath`, `type` |

```bash
# List — pipe to jq for COUNT/NAMES only; never print the array (it holds plaintext values).
curl -s "$INFISICAL_API_URL/v3/secrets/raw?workspaceId=<PID>&environment=<ENV>&secretPath=/" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.secrets[].secretKey'   # names only

# Create — send the value from a 600 file, mute the (value-echoing) response.
umask 077
BODY=$(mktemp)
# jq --arg escapes the value safely (printf would mangle ", \, %).
jq -n --arg pid "<PID>" --arg env "<ENV>" --arg val "$VALUE" \
  '{workspaceId:$pid, environment:$env, secretPath:"/", secretValue:$val, type:"shared"}' > "$BODY"
curl -s -X POST "$INFISICAL_API_URL/v3/secrets/raw/MY_SECRET" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d @"$BODY" >/dev/null
shred -u "$BODY"
```

**Response leak property:** the list response `secrets[]` contains `secretKey` **and** `secretValue`
as cleartext; get/create/update echo `secretValue` back. So:
- Always pipe responses through `jq` and extract only non-secret fields (names, counts, ids) — or
  write the body to a 600 file you consume programmatically. Never let the raw response render.
- Send values via `-d @file` (chmod 600) or `--data @-` from stdin, never inline `-d '{...}'`.
- There is also a non-raw (encrypted) endpoint family returning ciphertext that needs client-side
  decryption with the project key; `/raw` is what returns plaintext and what most integrations use.

## 3. Identities & scoping

A **machine identity** authenticates with a non-sensitive **Client ID** + a sensitive **Client
Secret**, exchanged at the login endpoint for a short-lived **access token**. Scope is two-tier: an
org-level role at creation, then per-project membership with a project role that decides which
paths/secrets it can touch. An identity with no project membership authenticates but reads nothing.
Token controls: TTL, Max TTL (renewal ceiling), Max Number of Uses. Protect the access token like any
password.

## Doc pointers

- Universal-auth login: `…/docs/api-reference/endpoints/universal-auth/login`
- Secrets CRUD: `…/docs/api-reference/endpoints/secrets/*`
- Machine identities: `…/docs/documentation/platform/identities/universal-auth`
