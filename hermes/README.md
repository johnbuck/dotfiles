# hermes/

Portable plugins for the [Hermes Agent](https://github.com/NousResearch/hermes-agent)
harness (the counterpart to `agents/` for OpenClaw). Topology-free — no hosts,
routes, or secrets; everything is read from config/env at runtime.

```
hermes/
└── plugins/
    └── image_gen/
        └── pnk_openrouter/   # OpenRouter backend for the native image_gen tool
```

## pnk-openrouter

A sixth `image_gen` backend so Hermes agents can generate images with any
OpenRouter image model (Gemini, Flux, GPT-Image, …) via the native tool — stock
Hermes ships none for OpenRouter. See
[`plugins/image_gen/pnk_openrouter/README.md`](plugins/image_gen/pnk_openrouter/README.md).
