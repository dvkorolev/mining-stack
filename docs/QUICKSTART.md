# 🚀 Quick Start Guide

Get Mining Stack up and running in 5 minutes!

## Prerequisites

- Docker (v20.10+) and Docker Compose (v2.0+)
- Git
- For Raspberry Pi: ARM64-based Pi (Pi 4 or newer recommended)

## Option 1: Local Development

Perfect for testing and development on your local machine.

```bash
# 1. Clone the repository
git clone https://github.com/dvkorolev/mining-stack.git
cd mining-stack

# 2. Start all services
docker compose -f docker-compose.dev.yml up --build
```

**Access the services:**
- 🌐 **Frontend Dashboard**: http://localhost:3000
- ⚙️ **Backend API**: http://localhost:5000
- 📊 **Prometheus**: http://localhost:9090
- 📈 **Grafana**: http://localhost:3001 (admin/mining123)

## Option 2: Production Deployment (Raspberry Pi)

Deploy to your Raspberry Pi using pre-built Docker images from GitHub Container Registry.

### From Your Development Machine

```bash
# 1. Clone the repository
git clone https://github.com/dvkorolev/mining-stack.git
cd mining-stack

# 2. Make deployment script executable
chmod +x deploy-from-registry.sh

# 3. Deploy to your Pi
./deploy-from-registry.sh pi raspberrypi.local
```

### Directly on Raspberry Pi

```bash
# 1. Clone the repository
git clone https://github.com/dvkorolev/mining-stack.git
cd mining-stack

# 2. Make deployment script executable
chmod +x deploy-from-registry.sh

# 3. Deploy locally
./deploy-from-registry.sh $(whoami) localhost
```

**Access the dashboard:**
- Replace `raspberrypi.local` with your Pi's IP address or hostname
- Open browser: http://raspberrypi.local:3000

## Next Steps

### Configure Your Miners

1. Edit the miners configuration file:
   ```bash
   nano /opt/mining-stack/etc/miners.yaml
   ```

2. Add your miners:
   ```yaml
   miners:
   - ip: 192.168.1.100
     model: Antminer S19
     alias: miner-01
     owner: Farm-A
     status: active
   ```

3. Restart the backend:
   ```bash
   cd /opt/mining-stack
   docker compose -f docker-compose.prod.yml restart backend
   ```

### Set Up Monitoring

See **[📊 Monitoring Guide](./MONITORING.md)** for:
- Grafana dashboard setup
- Prometheus metrics configuration
- Alert rules

### Enable Auto-Discovery

Automatically discover miners on your network:

```bash
cd /opt/mining-stack
./bin/setup-pyasic-venv.sh
./bin/setup-metrics-cron.sh
```

## Troubleshooting

### Dashboard Not Loading?

1. Check if containers are running:
   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```

2. Check logs:
   ```bash
   docker compose -f docker-compose.prod.yml logs backend
   docker compose -f docker-compose.prod.yml logs frontend
   ```

### Can't Access from Other Devices?

Make sure your firewall allows connections on ports 3000 and 5000.

### More Help

See **[🔍 Troubleshooting Guide](./TROUBLESHOOTING.md)** for detailed solutions.

## What's Next?

- **[📖 Deployment Guide](./DEPLOYMENT.md)** - Advanced deployment options
- **[⚙️ Configuration](./CONFIGURATION.md)** - Detailed configuration options
- **[🔌 API Reference](./API.md)** - Backend API documentation
- **[🏗️ CI/CD Setup](./CI_CD.md)** - Set up automated deployments

## Support

- 📧 Issues: https://github.com/dvkorolev/mining-stack/issues
- 💬 Discussions: https://github.com/dvkorolev/mining-stack/discussions
