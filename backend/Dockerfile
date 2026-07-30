# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Builder
# Install ALL dependencies and compile TypeScript → dist/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first — Docker layer cache:
# only re-runs npm ci when package-lock.json changes
COPY package*.json ./
COPY tsconfig.json ./

# Install everything (incl. devDependencies = @types/*, ts-node-dev)
# needed for tsc compilation
RUN npm ci --include=dev

# Copy source files
COPY src/ ./src/

# Compile TypeScript → /app/dist
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Runner
# Lean production image — only what's needed to run the server
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# dumb-init: proper PID 1 process that forwards OS signals (SIGTERM etc.)
# Critical for graceful shutdown to work correctly on Render
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only.
# NOTE: ts-node + typescript are in "dependencies" (not devDependencies),
# so they ARE included here — required for knex migration (.ts files).
RUN npm ci --omit=dev

# Copy compiled JS from builder stage
COPY --from=builder /app/dist ./dist

# Copy knexfile (migration runner reads this at startup)
COPY knexfile.ts ./

# Copy migration source files (knex needs the .ts files via ts-node/register)
COPY src/db/migrations ./src/db/migrations

# Copy tsconfig so ts-node can resolve the TypeScript config during migrations
COPY tsconfig.json ./

# Create the uploads directory and give ownership to the node user
RUN mkdir -p uploads && chown -R node:node uploads /app

# Run as non-root for security
USER node

# dumb-init as PID 1 so SIGTERM is forwarded to node correctly
# start:prod = npm run migrate && node dist/index.js
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start:prod"]
