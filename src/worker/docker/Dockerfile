FROM node:24-bookworm-slim AS build
WORKDIR /build
ENV PNPM_HOME=/pnpm
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY src/shared/package.json ./src/shared/
COPY src/web/package.json ./src/web/
COPY src/worker/package.json ./src/worker/
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --fetch-timeout=600000
COPY src/shared ./src/shared
COPY src/web ./src/web
COPY src/worker ./src/worker
RUN pnpm --filter @menote/web build && node src/worker/docker/build.mjs

FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /build/src/worker/dist/docker/server.mjs ./server.mjs
COPY --from=build --chown=node:node /build/src/web/dist ./web
RUN mkdir -p /app/state && chown node:node /app/state
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
