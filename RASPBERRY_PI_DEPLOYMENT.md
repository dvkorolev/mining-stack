# Raspberry Pi Deployment Guide

This guide will help you deploy the Mining Monitor stack to a Raspberry Pi.

## Prerequisites

1. A Raspberry Pi (3/4/5 recommended) with Raspberry Pi OS (64-bit) installed
2. Docker and Docker Compose installed on the Raspberry Pi
3. SSH access to the Raspberry Pi
4. The Raspberry Pi should be on the same network as your development machine

## Quick Start

1. **Clone the repository** on your development machine:
   ```bash
   git clone https://github.com/yourusername/mining-stack.git
   cd mining-stack
   ```

2. **Run the deployment script**:
   ```bash
   ./deploy-pi.sh [username] [hostname-or-ip]
   ```
   
   Example (default values):
   ```bash
   ./deploy-pi.sh pi raspberrypi.local
   ```

   The script will:
   - Create necessary directories on the Raspberry Pi
   - Copy all required files
   - Set up environment variables
   - Start all services using Docker Compose

## Accessing Services

After deployment, you can access the following services:

- **Dashboard**: http://raspberrypi.local:3000
- **API**: http://raspberrypi.local:5000
- **Prometheus**: http://raspberrypi.local:9090
- **Grafana**: http://raspberrypi.local:3001
  - Default credentials: admin/mining123

## Configuration

### Environment Variables

You can customize the deployment by editing the `.env` file on the Raspberry Pi after the first deployment:

```bash
nano /opt/mining-monitor/.env
```

### Updating the Deployment

To update your deployment:

1. Commit your changes to git
2. Pull the latest changes on your development machine
3. Run the deployment script again:
   ```bash
   ./deploy-pi.sh pi raspberrypi.local
   ```

## Troubleshooting

### View Logs

To view the logs of all services:

```bash
ssh pi@raspberrypi.local 'cd /opt/mining-monitor && docker compose logs -f'
```

### Restart Services

To restart all services:

```bash
ssh pi@raspberrypi.local 'cd /opt/mining-monitor && docker compose restart'
```

### Common Issues

1. **Permission denied** when running the script:
   ```bash
   chmod +x deploy-pi.sh
   ```

2. **Docker not installed** on Raspberry Pi:
   ```bash
   curl -sSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   ```

3. **Docker Compose not installed**:
   ```bash
   sudo apt-get update && sudo apt-get install -y docker-compose-plugin
   ```

## Security Considerations

1. Change the default Grafana password after first login
2. Consider setting up a reverse proxy with HTTPS
3. Use a strong password for the Raspberry Pi user
4. Keep your system and Docker images updated

## Support

For issues and feature requests, please open an issue on GitHub.
