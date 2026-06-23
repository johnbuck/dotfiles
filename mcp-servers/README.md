# mcp-servers

Reference for the MCP servers used across my Claude Code / OpenCode setups. Client wiring lives
in `claude/.mcp.json.example` and `opencode/opencode.json`; this doc covers the
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
| remotion | [`@remotion/mcp`](https://www.npmjs.com/package/@remotion/mcp) | 8405 |

## Stdio servers (run directly — no wrapper, no port)

The client launches these as a local stdio subprocess; there's no Docker image or supergateway
port. Wiring is the matching `stdio` entry in `claude/.mcp.json.example`.

| Server | npm package | Notes |
|--------|-------------|-------|
| playwright | [`@playwright/mcp`](https://www.npmjs.com/package/@playwright/mcp) | Browser automation. Launched as `npx -y @playwright/mcp@latest --browser chromium`. Also installable as the `playwright@claude-plugins-official` Claude Code plugin. |

## Running the stack

The build files are in this directory — `docker-compose.yml` plus a `<server>/Dockerfile` per
service. Nothing is vendored: each image runs `npm install -g <package> supergateway` at **build
time**, so Docker pulls the upstream package from npm for you.

```bash
cd mcp-servers
docker compose up -d --build
```

Each server then answers on its port over streamable HTTP (e.g. memory on `:8404`). Point your
MCP client at `http://<host>:<port>/mcp`.

### The wrapper pattern

Each `Dockerfile` is tiny — install the package + supergateway, then let supergateway bridge
stdio → streamable HTTP with a health endpoint. For example, `memory/Dockerfile`:

```dockerfile
FROM node:22-alpine
RUN npm install -g @modelcontextprotocol/server-memory supergateway
EXPOSE 8404
ENV MEMORY_FILE_PATH=/data/memory.json
CMD ["supergateway", "--stdio", "mcp-server-memory", \
     "--port", "8404", "--outputTransport", "streamableHttp", "--healthEndpoint", "/health"]
```

To pin a version, change the package to e.g. `@remotion/mcp@4.0.0` in that server's Dockerfile.

The custom servers (`ynab-mcp`, `excalidraw-mcp`) bring their own Dockerfile/compose in their repos.
