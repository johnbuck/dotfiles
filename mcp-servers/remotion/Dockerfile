FROM node:22-alpine
RUN npm install -g @remotion/mcp@latest supergateway
EXPOSE 8405
CMD ["supergateway", "--stdio", "remotion-mcp", "--port", "8405", "--outputTransport", "streamableHttp", "--healthEndpoint", "/health"]
