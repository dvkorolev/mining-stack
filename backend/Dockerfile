# Use platform-specific base image for M1 Macs
FROM --platform=linux/amd64 node:18-alpine AS builder

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
FROM node:18-alpine

WORKDIR /app

# Install Python, build dependencies, and pyasic
RUN apk add --no-cache \
    python3 \
    py3-pip \
    python3-dev \
    gcc \
    musl-dev \
    linux-headers && \
    pip3 install --no-cache-dir --break-system-packages pyasic pyyaml netifaces aiohttp

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

# Start the application using the init script
CMD ["/app/init.sh", "node", "dist/server.js"]
