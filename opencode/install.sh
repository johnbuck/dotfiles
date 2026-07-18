#!/usr/bin/env bash
# Deploy this repo's OpenCode config into ~/.config/opencode on the current machine.
# - Backs up anything it would overwrite to ~/.config/opencode/backups/config-import-<ts>/.
# - Copies sanitized config + .example secret templates. Never writes real secrets.
# - Leaves __MCP_HOST__ / __LLM_HOST__ placeholders for you to fill in by hand.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.config/opencode"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="$DEST/backups/config-import-$TS"

say() { printf '\033[36m==>\033[0m %s\n' "$1"; }

mkdir -p "$DEST" "$BACKUP" "$DEST/secrets"

backup_if_exists() {
  local target="$1"
  if [ -e "$target" ]; then
    local rel="${target#$DEST/}"
    mkdir -p "$BACKUP/$(dirname "$rel")"
    cp -r "$target" "$BACKUP/$rel"
  fi
}

say "Installing into $DEST (backups -> $BACKUP)"

# Top-level config files
for f in opencode.json oh-my-openagent.json; do
  backup_if_exists "$DEST/$f"
  cp "$REPO/$f" "$DEST/$f"
done

# agents/ and commands/
for d in agents commands; do
  mkdir -p "$DEST/$d"
  for f in "$REPO/$d"/*; do
    backup_if_exists "$DEST/$d/$(basename "$f")"
    cp "$f" "$DEST/$d/"
  done
done

# secrets/: copy .example templates only (never overwrites your real key files)
for f in "$REPO"/secrets/*.example; do
  cp "$f" "$DEST/secrets/$(basename "$f")"
done

# plugins/: portable opencode plugins (e.g. the pnk-guardrails secret + destructive-command guard)
if [ -d "$REPO/plugins" ]; then
  mkdir -p "$DEST/plugins"
  for f in "$REPO"/plugins/*.js; do
    [ -e "$f" ] || continue
    backup_if_exists "$DEST/plugins/$(basename "$f")"
    cp "$f" "$DEST/plugins/"
  done
fi

say "config + agents + commands + plugins + secret templates installed"

cat <<EOF

Done.

Finish setup by hand (these involve hosts + real secrets, never automated):
  1. Edit ~/.config/opencode/opencode.json and replace:
       __MCP_HOST__   -> host running your MCP servers
       __LLM_HOST__   -> host running your local llama.cpp server
     (or remove the mcp/provider entries you don't use)
  2. For each secrets/*.example, create the real file without the .example
     suffix and paste in your key, e.g.:
       cp ~/.config/opencode/secrets/todoist-api-key.example \\
          ~/.config/opencode/secrets/todoist-api-key
       \$EDITOR ~/.config/opencode/secrets/todoist-api-key
     Then: chmod 600 ~/.config/opencode/secrets/*
  3. Restart OpenCode.

Anything overwritten was backed up to: $BACKUP
EOF
