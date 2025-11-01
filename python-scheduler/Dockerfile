FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy scheduler service
COPY scheduler.py /app/

# Create directories for mounted volumes
RUN mkdir -p /metrics /app/bin /app/etc

# Expose API port
EXPOSE 8000

# Start scheduler service
CMD ["python", "-u", "scheduler.py"]
