FROM node:22-alpine
RUN npm install -g n8n-mcp supergateway
EXPOSE 8402
CMD ["supergateway", "--stdio", "n8n-mcp", "--port", "8402", "--outputTransport", "streamableHttp", "--healthEndpoint", "/health"]
