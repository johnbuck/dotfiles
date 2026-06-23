# pnk-openrouter — Hermes `image_gen` backend for OpenRouter

Adds a sixth `image_gen` backend so Hermes agents can generate images with **any
OpenRouter image model** (Gemini, Flux, GPT-Image, Recraft, …) through the native
`image_gen` tool. Stock Hermes ships `fal/krea/openai/openai-codex/xai` — none of
which speaks OpenRouter.

## How it works

OpenRouter exposes image models via the **chat/completions** endpoint with a
`modalities` field (not a DALL-E-style `/images/generations` endpoint). Images
come back as base64 data URLs at `choices[0].message.images[]`. This backend
POSTs that request and saves the result under `$HERMES_HOME/cache/images/`.

## Install

Drop this directory into a hermes plugins root under `image_gen/`, e.g.
`$HERMES_HOME/plugins/image_gen/pnk_openrouter/`, then enable it:

```bash
hermes plugins enable pnk-openrouter   # user plugins are gated by plugins.enabled
```

(Directory name is `pnk_openrouter` — underscore, so Python can import it. The
provider id used in config is `pnk-openrouter`.)

## Configure (`config.yaml`)

```yaml
image_gen:
  provider: pnk-openrouter
  pnk-openrouter:
    model: google/gemini-2.5-flash-image      # any OpenRouter image model id
    base_url: https://openrouter.ai/api/v1     # or an upstream gateway route
    modalities: [image, text]                  # use [image] for image-only models
```

Model precedence: `OPENROUTER_IMAGE_MODEL` env → `image_gen.pnk-openrouter.model`
→ `image_gen.model` → default (`google/gemini-2.5-flash-image`).

## Keys

The `Authorization: Bearer` header is read from `OPENROUTER_API_KEY` (or
`OPENROUTER_KEY`), defaulting to a placeholder. When `base_url` points at a
gateway that injects the real key (overwriting `Authorization`), the container
never needs to hold one — the recommended setup.

## Test

```bash
python3 test_pnk_openrouter.py     # topology-free, mocks agent.image_gen_provider + httpx
```

> Portable / topology-free: every endpoint and key comes from config or env at
> runtime. No host names, routes, or secrets belong in this directory.
