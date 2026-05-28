FROM node:22-alpine
RUN npm install -g @modelcontextprotocol/server-sequential-thinking supergateway
EXPOSE 8406
CMD ["supergateway", "--stdio", "mcp-server-sequential-thinking", "--port", "8406", "--outputTransport", "streamableHttp", "--healthEndpoint", "/health"]
