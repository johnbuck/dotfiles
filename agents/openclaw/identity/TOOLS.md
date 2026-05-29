# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

## Proxy Routes

All accessible from OpenClaw via `http://gateway:8080/`:

| Route | Service | Notes |
|-------|---------|-------|
| `http://gateway:8080/llama/v1` | llama-cpp (OpenAI-compatible API) | Model: `Qwen3.6-35B-A3B-UD-IQ4_NL_XL`. Use `max_tokens: 2048+` — model thinks before outputting. |
| `http://gateway:8080/searxng` | SearXNG | Params: `q`, `format=json`, `time_range` (day/week/month), `pageno`. No need to specify engines. |

---

Add whatever helps you do your job. This is your cheat sheet.
