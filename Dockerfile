FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind all interfaces — the default loopback bind is unreachable from a k8s probe.
ENV HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
# `output: "standalone"` in next.config.ts emits server.js plus a pruned
# node_modules, so the runtime stage needs no install of its own.
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
# NOTE: /healthz must be a real route in the app. The Kubernetes liveness and
# readiness probes and the ALB target-group health check all point at it too
# (k8s/APP_NAME/values.yaml). If the app uses a different path, change it in
# all four places — do not leave a probe aimed at a route that does not exist.
# 127.0.0.1, not localhost: the server binds IPv4 only, and busybox wget resolves
# localhost to ::1 first, which is refused.
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
