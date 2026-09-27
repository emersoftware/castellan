# Game server + built web client in one image.
FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @aoa/web build
ENV PORT=4400 REPLAY_DIR=/data/replays
EXPOSE 4400
CMD ["pnpm", "--filter", "@aoa/server", "start"]
