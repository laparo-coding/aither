# ─────────────────────────────────────────────────────────────
# aither — Next.js 16 Dev Container
# ─────────────────────────────────────────────────────────────
# Multi-stage build: deps → dev (hot-reload) / prod (standalone)
#
# Usage:
#   Dev:  docker compose up aither-dev
#   Prod: docker compose up aither
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Dependencies ────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

# Install libc6-compat for Alpine + native modules
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: Dev (hot-reload via bind mount) ─────────────────
FROM node:24-alpine AS dev
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js Telemetrie deaktivieren
ENV NEXT_TELEMETRY_DISABLED=1

# Run as non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "-p", "3000"]

# ── Stage 3: Build ───────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 4: Production runner ───────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Output-Verzeichnis für generierte HTML-Slides
RUN mkdir -p output && chown nextjs:nodejs output
VOLUME ["/app/output"]

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
