FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for building Python packages
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    make \
    libffi-dev \
    libssl-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Upgrade pip and setuptools
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY main.py config.py metrics.py /app/
COPY collectors/ /app/collectors/
COPY parsers/ /app/parsers/

# Create directories for mounted volumes
RUN mkdir -p /metrics /app/bin /app/etc

# Expose API port
EXPOSE 8000

# Start scheduler service
CMD ["python", "-u", "main.py"]
