# ==============================================================================
# Stage 1: Build & Compile TypeScript Source
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install build tools in case native Node binaries (e.g., buffer/crypto packages) require compilation
RUN apk add --no-cache python3 make g++

# Copy package manifests first to maximize Docker build layer caching
COPY package.json package-lock.json ./

# Perform a clean install of all dependencies (including devDependencies required for tsc compilation)
RUN npm ci

# Copy TypeScript configuration and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript output in /dist
RUN npm run build

# Remove development dependencies to keep the final production layer compact
RUN npm prune --production

# ==============================================================================
# Stage 2: Lightweight Production Runtime Container
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Configure enterprise production environment defaults
ENV NODE_ENV=production
ENV PORT=3000

# Install Git and OpenSSH client: Critical for Aegis CodeScoperWorker and GitDiffWorker
# to clone repositories, inspect blame logs, and analyze version control regressions.
# Also install curl for container health monitoring.
RUN apk add --no-cache git openssh-client curl

# Enforce least-privilege security by running as non-root unprivileged 'node' user
USER node

# Copy package manifests and pruned production node_modules from builder
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Copy compiled JavaScript output bundle from builder
COPY --chown=node:node --from=builder /app/dist ./dist

# Expose HTTP ingress port for webhook notifications and health checks
EXPOSE 3000

# Automated container health check against our established API health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/webhooks/health || exit 1

# Launch the production HTTP server and BullMQ background queue processing loop
CMD ["node", "dist/index.js"]
