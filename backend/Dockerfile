# ── Build stage ───────────────────────────────────────────────────────────────
# node:20-slim (Debian) rather than alpine: `sharp` ships prebuilt binaries that
# are far less fragile on glibc, and the image is still small enough.
FROM node:20-slim AS build

WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Drop root. The `node` user ships with the official image.
USER node

EXPOSE 5000

# Liveness only — /health is intentionally unconditional (see app.ts).
# Orchestrators wanting dependency state should probe /api/v1/health/ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
