FROM node:22-alpine
RUN npm install -g @davidfuchs/mcp-uptime-kuma supergateway
EXPOSE 8403
CMD ["supergateway", "--stdio", "mcp-uptime-kuma", "--port", "8403", "--outputTransport", "streamableHttp", "--healthEndpoint", "/health"]
