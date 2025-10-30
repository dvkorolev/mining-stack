#!/bin/sh
set -e

# Create logs directory if it doesn't exist
mkdir -p /app/logs

# Ensure the Node.js process can write to the logs directory
chown -R node:node /app/logs

# Start the application
exec "$@"
