# hermes/

Portable plugins **and skills** for the [Hermes Agent](https://github.com/NousResearch/hermes-agent)
harness (the counterpart to `agents/` for OpenClaw). Topology-free — no hosts,
routes, or secrets; everything is read from config/env at runtime. Site-specific
versions (with real hosts/paths/IDs) live in a private infra repo, not here.

```
hermes/
├── plugins/
│   └── image_gen/
│       └── pnk_openrouter/   # OpenRouter backend for the native image_gen tool
└── skills/
    └── pnk-searxng/          # operate SearXNG with proxy egress (SKILL.md)
```

Skills are AgentSkills `SKILL.md` files dropped into a dir listed in the agent's
`skills.external_dirs`; the `description` drives on-demand loading.

## pnk-openrouter

A sixth `image_gen` backend so Hermes agents can generate images with any
OpenRouter image model (Gemini, Flux, GPT-Image, …) via the native tool — stock
Hermes ships none for OpenRouter. See
[`plugins/image_gen/pnk_openrouter/README.md`](plugins/image_gen/pnk_openrouter/README.md).
