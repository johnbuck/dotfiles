#!/usr/bin/env bash
# Deploy this repo's Claude Code config into ~/.claude on the current machine.
# - Resolves the __HOME__ token to your real $HOME.
# - Backs up anything it would overwrite to ~/.claude/backups/config-import-<ts>/.
# - Never touches credentials, history, or live .mcp.json.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.claude"
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

# Render a file replacing __HOME__ with the real home dir.
render() {
  sed "s|__HOME__|$HOME|g" "$1" > "$2"
}

say "Installing into $DEST (backups -> $BACKUP)"

# settings.json (rendered)
backup_if_exists "$DEST/settings.json"
render "$REPO/settings.json" "$DEST/settings.json"
say "settings.json written"

# scripts/
mkdir -p "$DEST/scripts"
for f in "$REPO"/scripts/*; do
  backup_if_exists "$DEST/scripts/$(basename "$f")"
  cp "$f" "$DEST/scripts/"
  chmod +x "$DEST/scripts/$(basename "$f")"
done
say "scripts/ installed"

# agents/
mkdir -p "$DEST/agents"
for f in "$REPO"/agents/*.md; do
  backup_if_exists "$DEST/agents/$(basename "$f")"
  cp "$f" "$DEST/agents/"
done
say "agents/ installed"

# workflows/ (e.g. pnk-baton)
if [ -d "$REPO/workflows" ]; then
  mkdir -p "$DEST/workflows"
  for f in "$REPO"/workflows/*; do
    backup_if_exists "$DEST/workflows/$(basename "$f")"
    cp "$f" "$DEST/workflows/"
  done
  say "workflows/ installed"
fi

# commands/ (slash commands, e.g. /pnk-baton)
if [ -d "$REPO/commands" ]; then
  mkdir -p "$DEST/commands"
  for f in "$REPO"/commands/*.md; do
    backup_if_exists "$DEST/commands/$(basename "$f")"
    cp "$f" "$DEST/commands/"
  done
  say "commands/ installed"
fi

# hooks/ (Claude Code hooks, e.g. pnk-baton-guard.sh — opt-in per repo via settings.json)
if [ -d "$REPO/hooks" ]; then
  mkdir -p "$DEST/hooks"
  for f in "$REPO"/hooks/*; do
    backup_if_exists "$DEST/hooks/$(basename "$f")"
    cp "$f" "$DEST/hooks/"
    chmod +x "$DEST/hooks/$(basename "$f")"
  done
  say "hooks/ installed"
fi

# skills/ (Claude Code Skills, e.g. pnk-secret-hygiene — each is a dir with SKILL.md +
# optional references/ and scripts/, so copy the whole tree, not just top-level files)
if [ -d "$REPO/skills" ]; then
  mkdir -p "$DEST/skills"
  for d in "$REPO"/skills/*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    backup_if_exists "$DEST/skills/$name"
    rm -rf "$DEST/skills/$name"
    cp -r "$d" "$DEST/skills/$name"
    # make any bundled scripts executable
    if [ -d "$DEST/skills/$name/scripts" ]; then
      find "$DEST/skills/$name/scripts" -type f -exec chmod +x {} +
    fi
  done
  say "skills/ installed"
fi

# local plugin (do-the-thing)
backup_if_exists "$DEST/plugins/local/project-planning"
mkdir -p "$DEST/plugins/local"
rm -rf "$DEST/plugins/local/project-planning"
cp -r "$REPO/plugins/local/project-planning" "$DEST/plugins/local/project-planning"
say "local do-the-thing plugin installed"

# plugin manifests (rendered) — reference state; backed up first
mkdir -p "$DEST/plugins"
for m in installed_plugins.json known_marketplaces.json; do
  backup_if_exists "$DEST/plugins/$m"
  render "$REPO/plugins/$m" "$DEST/plugins/$m"
done
say "plugin manifests written"

# Wire the secret-scan hook for commits made in THIS repo (hooks live at repo root).
TOPLEVEL="$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$TOPLEVEL" ] && [ -f "$TOPLEVEL/hooks/pre-commit" ]; then
  git -C "$TOPLEVEL" config core.hooksPath hooks
  chmod +x "$TOPLEVEL/hooks/pre-commit"
  say "pre-commit secret-scan hook enabled for this repo"
fi

cat <<EOF

Done.

Next steps you do by hand (these involve secrets / accounts, never automated):
  1. Log in:        claude  (then authenticate)
  2. MCP servers:   cp $REPO/.mcp.json.example ~/.claude/.mcp.json  and fill in real tokens
  3. Restart Claude Code so it picks up settings + plugins.

Anything overwritten was backed up to: $BACKUP
EOF
