# Docker Compose File Fix

## Issues Fixed

### 1. Obsolete `version` Field
**Problem:**
```
WARN: the attribute `version` is obsolete, it will be ignored
```

**Solution:**
Removed `version: '3.8'` from `docker-compose.logging.yml`. Docker Compose V2 doesn't require or use this field.

### 2. Service Extension Error
**Problem:**
```
service "python-scheduler" has neither an image nor a build context specified: invalid compose project
```

**Root Cause:**
The logging compose file extends services from the production compose file. When used alone, it doesn't have the base service definitions.

**Solution:**
The file is designed to be used **together** with `docker-compose.prod.yml`:
```bash
# Correct usage
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml up -d

# Incorrect usage (causes error)
docker compose -f docker-compose.logging.yml up -d
```

### 3. Platform Specification
**Added:**
```yaml
platform: linux/arm64
```
to both Loki and Promtail services for Raspberry Pi compatibility.

## Changes Made to `docker-compose.logging.yml`

```diff
- # Usage: docker-compose -f docker-compose.yml -f docker-compose.logging.yml up
+ # Usage: docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml up

- version: '3.8'
-
  services:
    loki:
      image: grafana/loki:2.9.0
+     platform: linux/arm64
      container_name: loki
      
    promtail:
      image: grafana/promtail:2.9.0
+     platform: linux/arm64
      container_name: promtail
```

## How It Works

### Compose File Merging

Docker Compose merges multiple files in order:

1. **Base file** (`docker-compose.prod.yml`):
   - Defines all services with images
   - Sets up networks and volumes
   - Configures base environment

2. **Extension file** (`docker-compose.logging.yml`):
   - Adds Loki and Promtail services
   - Extends existing services with labels
   - Adds logging-specific environment variables

### Service Extension Example

**In `docker-compose.prod.yml`:**
```yaml
services:
  python-scheduler:
    image: ghcr.io/.../python-scheduler:latest
    ports:
      - "8000:8000"
```

**In `docker-compose.logging.yml`:**
```yaml
services:
  python-scheduler:
    labels:
      logging: "promtail"
    environment:
      - LOG_FORMAT=json
```

**Merged result:**
```yaml
services:
  python-scheduler:
    image: ghcr.io/.../python-scheduler:latest
    ports:
      - "8000:8000"
    labels:
      logging: "promtail"
    environment:
      - LOG_FORMAT=json
```

## Validation

To validate the merged compose configuration on Raspberry Pi:

```bash
cd /opt/mining-stack

# Check merged configuration
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml config

# Validate services
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml config --services

# Check for errors
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml config --quiet
```

## Update Script Compatibility

The `update-from-registry.sh` script already uses both files correctly:

```bash
# Pull images
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.logging.yml pull

# Stop containers
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml down --rmi local

# Start containers
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml up -d

# Show status
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps
```

## Testing on Raspberry Pi

After pulling the updated files:

```bash
cd /opt/mining-stack

# Test configuration validation
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml config --quiet
echo $?  # Should output: 0

# Start all services
./update-from-registry.sh

# Verify all 9 services are running
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps
```

Expected output:
```
NAME                  IMAGE                              STATUS
python-scheduler      ghcr.io/.../python-scheduler       Up
backend               ghcr.io/.../backend                Up
frontend              ghcr.io/.../frontend               Up
prometheus            prom/prometheus:latest             Up
grafana               grafana/grafana:latest             Up
blackbox-exporter     prom/blackbox-exporter:latest      Up
alertmanager          prom/alertmanager:latest           Up
loki                  grafana/loki:2.9.0                 Up
promtail              grafana/promtail:2.9.0             Up
```

## Common Errors and Solutions

### Error: "version is obsolete"
**Solution:** Already fixed - removed from file

### Error: "service has neither an image nor a build context"
**Solution:** Always use both compose files together

### Error: "network mining-network not found"
**Solution:** Ensure docker-compose.prod.yml is loaded first (it creates the network)

### Error: "platform not supported"
**Solution:** Already fixed - added `platform: linux/arm64` for Raspberry Pi

## References

- [Docker Compose File Specification](https://docs.docker.com/compose/compose-file/)
- [Docker Compose Merge Behavior](https://docs.docker.com/compose/multiple-compose-files/merge/)
- [Docker Compose V2 Changes](https://docs.docker.com/compose/compose-v2/)
