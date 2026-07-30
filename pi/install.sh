#!/usr/bin/env bash
# Deploy this repo's pi config into ~/.pi/agent on the current machine.
# - Backs up anything it would overwrite to ~/.pi/agent/backups/config-import-<ts>/.
# - NEVER touches auth.json, keys.env, models-store.json, or sessions/ (secrets/state).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.pi/agent"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="$DEST/backups/config-import-$TS"

say() { printf '\033[36m==>\033[0m %s\n' "$1"; }

mkdir -p "$DEST" "$BACKUP"

backup_if_exists() {
  local target="$1"
  if [ -e "$target" ]; then
    local rel="${target#$DEST/}"
    mkdir -p "$BACKUP/$(dirname "$rel")"
    cp -r "$target" "$BACKUP/$rel"
  fi
}

say "Installing into $DEST (backups -> $BACKUP)"

# extensions/ (pi TypeScript extensions — auto-discovered globally by pi, no trust gate)
if [ -d "$REPO/extensions" ]; then
  mkdir -p "$DEST/extensions"
  for f in "$REPO"/extensions/*; do
    [ -f "$f" ] || continue
    backup_if_exists "$DEST/extensions/$(basename "$f")"
    cp "$f" "$DEST/extensions/"
  done
  say "extensions/ installed"
fi

# mcp.json (rendered template -> ~/.pi/agent/mcp.json).
#   __HOME__     -> $HOME  (serena binary path)
#   __MCP_HOST__ -> $MCP_HOST (LAN addr of the host running the HTTP MCP servers)
# ${COGNEE_MCP_TOKEN} is left literal — pi resolves it at runtime from keys.env.
# Requires MCP_HOST; skipped with instructions if unset (per-environment, never hardcoded).
if [ -f "$REPO/mcp.json.example" ]; then
  if [ -n "${MCP_HOST:-}" ]; then
    backup_if_exists "$DEST/mcp.json"
    sed -e "s|__HOME__|$HOME|g" -e "s|__MCP_HOST__|$MCP_HOST|g" "$REPO/mcp.json.example" > "$DEST/mcp.json"
    say "mcp.json written (MCP_HOST=$MCP_HOST)"
  else
    say "mcp.json SKIPPED — set MCP_HOST=<wiley LAN addr> and re-run, or copy mcp.json.example by hand"
  fi
fi

# Deploy the shared secret-leak-guard for pi (adapter + core).
SG="$(dirname "$REPO")/secrets-guard/install.sh"
[ -x "$SG" ] && "$SG" --harness pi || say "secrets-guard/install.sh not found; skipping guard deploy"

# Wire the repo's pre-commit secret-scan hook (idempotent; same as claude/install.sh).
TOPLEVEL="$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$TOPLEVEL" ] && [ -f "$TOPLEVEL/hooks/pre-commit" ]; then
  git -C "$TOPLEVEL" config core.hooksPath hooks
  chmod +x "$TOPLEVEL/hooks/pre-commit"
  say "pre-commit secret-scan hook enabled for this repo"
fi

cat <<EOF

Done.

What install.sh deliberately NEVER touches (secrets / per-machine state):
  ~/.pi/agent/auth.json          (provider auth)
  ~/.pi/agent/keys.env           (API keys)
  ~/.pi/agent/models-store.json  (cached model catalog)
  ~/.pi/agent/sessions/          (session history)

Extensions auto-load on the next pi start, or run /reload in a live session.

Anything overwritten was backed up to: $BACKUP
EOF
