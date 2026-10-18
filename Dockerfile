FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:24-alpine AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG APPLICATION_VERSION=dev
LABEL org.opencontainers.image.revision=$APPLICATION_VERSION
RUN addgroup -S app && adduser -S app -G app
USER app

FROM runtime-base AS worker-runtime
COPY --from=builder --chown=app:app /app/dist/worker.mjs ./worker.mjs
COPY --from=builder --chown=app:app /app/dist/worker-build.json ./worker-build.json
STOPSIGNAL SIGTERM
CMD ["node", "worker.mjs"]

FROM runtime-base AS web-runtime
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
