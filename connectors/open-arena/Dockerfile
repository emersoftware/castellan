FROM node:24.14.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git procps iptables util-linux python3 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && npm install -g @openai/codex@0.163.0 @anthropic-ai/claude-code@2.1.306
WORKDIR /app
COPY . .
RUN pnpm --filter @castellan/open-arena... --filter @castellan/loop-keepers... --filter @castellan/mcp... install --prod --frozen-lockfile && ln -s /app/connectors/mcp/node_modules/tsx /app/node_modules/tsx && mkdir -p /data && chown 1000:1000 /data && chmod +x connectors/open-arena/entrypoint.sh
ENV NODE_ENV=production
