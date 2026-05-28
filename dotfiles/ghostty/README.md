# ghostty

[Ghostty](https://ghostty.org) terminal configuration.

| Path | What it is |
|------|------------|
| `config` | Main config — theme, font (JetBrains Mono 13), window padding, 50k scrollback, bar cursor, shell integration, copy-on-select, quake-style quick terminal on `ctrl+\``. |
| `themes/Eldritch` | Custom color theme. |

## Install on a new machine

```bash
mkdir -p ~/.config/ghostty/themes
cp config ~/.config/ghostty/config
cp themes/Eldritch ~/.config/ghostty/themes/Eldritch
```

Restart Ghostty (or reload config) to apply. The active theme is set by the `theme =` line in
`config`; switch it to `Eldritch` there if you want the bundled theme instead of the default.
