# mcp-servers

Reference for the MCP servers used across my Claude Code / OpenCode setups. Client wiring lives
in `dotfiles/claude/.mcp.json.example` and `dotfiles/opencode/opencode.json`; this doc covers the
**servers** themselves.

## Custom servers (my own code — separate repos)

| Server | Repo | What it does |
|--------|------|--------------|
| `ynab-mcp` | https://github.com/johnbuck/ynab-mcp | YNAB budget access + AI-assisted categorization. Ships Dockerfile + compose + `.env.example`. |
| `excalidraw-mcp` | https://github.com/johnbuck/excalidraw-mcp | Generate Excalidraw/Obsidian diagrams from YAML; includes a stdio MCP server. |

## Off-the-shelf servers (just point at upstream)

These are upstream npm packages, each run as a stdio server and exposed over HTTP with
[`supergateway`](https://www.npmjs.com/package/supergateway). Nothing to fork — pin the package and wrap it.

| Server | npm package | Port |
|--------|-------------|------|
| memory | [`@modelcontextprotocol/server-memory`](https://www.npmjs.com/package/@modelcontextprotocol/server-memory) | 8404 |
| sequential-thinking | [`@modelcontextprotocol/server-sequential-thinking`](https://www.npmjs.com/package/@modelcontextprotocol/server-sequential-thinking) | 8406 |
| n8n-mcp | [`n8n-mcp`](https://www.npmjs.com/package/n8n-mcp) | 8402 |
| uptime-kuma | [`@davidfuchs/mcp-uptime-kuma`](https://www.npmjs.com/package/@davidfuchs/mcp-uptime-kuma) | 8403 |
| remotion | [`@remotion/mcp`](https://www.npmjs.com/package/@remotion/mcp) | 8405 |

> n8n-mcp and uptime-kuma point at your own n8n / Uptime Kuma instances, so they're only useful on
> a network where those exist.

## The wrapper pattern

Each off-the-shelf server is a tiny image: install the package + supergateway, then let supergateway
bridge stdio → streamable HTTP with a health endpoint.

```dockerfile
FROM node:22-alpine
RUN npm install -g @modelcontextprotocol/server-memory supergateway
EXPOSE 8404
ENV MEMORY_FILE_PATH=/data/memory.json
CMD ["supergateway", "--stdio", "mcp-server-memory", \
     "--port", "8404", "--outputTransport", "streamableHttp", "--healthEndpoint", "/health"]
```

## Compose (sanitized)

Generic, self-contained stack. Tokens come from a local `.env` (never committed); replace ports/hosts
to taste.

```yaml
services:
  memory-mcp:
    build: ./memory
    ports: ["8404:8404"]
    volumes: ["memory-data:/data"]
    restart: unless-stopped

  sequential-thinking-mcp:
    build: ./sequential-thinking
    ports: ["8406:8406"]
    restart: unless-stopped

  uptime-kuma-mcp:
    build: ./uptime-kuma
    ports: ["8403:8403"]
    env_file: [.env]          # UPTIME_KUMA_URL, UPTIME_KUMA_USERNAME, UPTIME_KUMA_PASSWORD, etc.
    restart: unless-stopped

  n8n-mcp:
    build: ./n8n
    ports: ["8402:8402"]
    env_file: [.env]          # N8N_API_URL, N8N_API_KEY
    restart: unless-stopped

volumes:
  memory-data:
```

The custom servers (`ynab-mcp`, `excalidraw-mcp`) bring their own Dockerfile/compose in their repos.
