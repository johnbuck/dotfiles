FROM node:22-alpine
RUN npm install -g @modelcontextprotocol/server-memory supergateway
EXPOSE 8404
ENV MEMORY_FILE_PATH=/data/memory.json
CMD ["supergateway", "--stdio", "mcp-server-memory", "--port", "8404", "--outputTransport", "streamableHttp", "--healthEndpoint", "/health"]
