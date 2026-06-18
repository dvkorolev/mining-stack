# Build argument for platform flexibility
ARG PLATFORM=linux/amd64

# ========== BUILDER STAGE ==========
FROM --platform=${PLATFORM} node:18.18.2-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies
RUN npm ci --include=dev

# Copy source code
COPY . .

# Build the application
RUN npm run build

# ========== DEPS STAGE - Production dependencies only ==========
FROM --platform=${PLATFORM} node:18.18.2-alpine AS deps

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# ========== PRODUCTION STAGE ==========
FROM --platform=${PLATFORM} node:18.18.2-alpine AS production

WORKDIR /app

# Copy production node_modules from deps stage (already compiled)
COPY --from=deps /app/node_modules ./node_modules

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Copy necessary non-compiled files
COPY src/config ./dist/config
COPY init.sh ./init.sh
COPY scripts ./scripts

# Create logs directory and set permissions in single layer
RUN mkdir -p /app/logs && \
    chown -R node:node /app && \
    chmod +x /app/init.sh && \
    (test -f /app/dist/scripts/migrate-yaml-to-db.js || echo "Warning: Migration script not found")

# Switch to non-root user
USER node

# Expose port 5000
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

# Start the application
CMD ["/app/init.sh", "node", "dist/server.js"]
