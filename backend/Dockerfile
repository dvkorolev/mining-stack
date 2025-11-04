# Build argument for platform flexibility
ARG PLATFORM=linux/amd64

# Use platform-specific base image with specific version
FROM --platform=${PLATFORM} node:18.18.2-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies including devDependencies
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production image
FROM node:18.18.2-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy necessary non-compiled files
COPY --from=builder /app/src/config ./dist/config
COPY --from=builder /app/package.json ./
COPY --from=builder /app/init.sh /app/init.sh

# Create logs directory and set permissions
RUN mkdir -p /app/logs && \
    chown -R node:node /app && \
    chmod +x /app/init.sh

# Switch to non-root user
USER node

# Expose port 5000
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

# Start the application using the init script
CMD ["/app/init.sh", "node", "dist/server.js"]
