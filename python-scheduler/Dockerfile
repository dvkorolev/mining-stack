FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    cron \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy scripts
COPY scripts/ /app/scripts/
COPY bin/ /app/bin/

# Make scripts executable
RUN chmod +x /app/bin/*.py /app/bin/*.sh

# Copy scheduler service
COPY scheduler.py /app/
COPY crontab /etc/cron.d/mining-metrics

# Setup cron
RUN chmod 0644 /etc/cron.d/mining-metrics && \
    crontab /etc/cron.d/mining-metrics && \
    touch /var/log/cron.log

# Create metrics directory
RUN mkdir -p /metrics

# Expose API port for manual triggers
EXPOSE 8000

# Start scheduler service
CMD ["python", "-u", "scheduler.py"]
