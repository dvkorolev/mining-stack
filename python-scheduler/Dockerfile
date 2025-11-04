# Build stage - Install dependencies and build wheels
FROM python:3.11-slim AS builder

WORKDIR /app

# Install system dependencies for building Python packages
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    make \
    libffi-dev \
    libssl-dev \
    python3-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Upgrade pip and setuptools
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install Python dependencies to a target directory
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Production stage - Lean runtime image
FROM python:3.11-slim

WORKDIR /app

# Install only runtime dependencies (curl for healthchecks)
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application files
COPY main.py config.py metrics.py logging_config.py /app/
COPY collectors/ /app/collectors/
COPY parsers/ /app/parsers/
COPY asic_profile_loader.py /app/
COPY state_manager.py /app/
COPY health_check.py /app/
COPY asic_profiles.yaml /app/

# Create directories for mounted volumes and state
RUN mkdir -p /metrics /app/bin /app/etc /app/data && \
    chmod 755 /app/data

# Expose API port
EXPOSE 8000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Start scheduler service
CMD ["python", "-u", "main.py"]
