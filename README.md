# Mining Stack Monitor 🚀

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)](https://reactjs.org/)

A comprehensive monitoring and control system for cryptocurrency mining operations, built with React, Node.js, and Docker. Designed to run on a Raspberry Pi or any Linux system with real-time monitoring, advanced analytics, and automated miner discovery.

## ✨ Features

- **Real-time Monitoring**: Track mining statistics (hashrate, active miners, total mined)
- **Historical Data**: Beautiful charts and graphs for performance analysis
- **WebSocket Support**: Real-time updates without page refreshes
- **Responsive Design**: Material-UI based interface that works on desktop and mobile
- **Dockerized**: Easy deployment with Docker Compose
- **Advanced Monitoring**: Integrated with Prometheus and Grafana for metrics and alerting
- **Miner Discovery**: Automatically detect miners on your network using pyasic
- **Multi-Platform**: Supports x86_64 and ARM64 (Raspberry Pi)

## 📋 Prerequisites

- Docker (v20.10+)
- Docker Compose (v2.0+)
- Node.js (v16+) - Only needed for local development without Docker
- Python 3.8+ (for miner discovery scripts)

## 🚀 Quick Start

### Development with Docker

```bash
# 1. Clone the repository
git clone https://github.com/dvkorolev/mining-stack.git
cd mining-stack

# 2. Start development environment
docker compose -f docker-compose.dev.yml up --build
```

**Access the services:**
- 🌐 **Frontend**: http://localhost:3000
- ⚙️ **Backend API**: http://localhost:5000
- 📊 **Prometheus**: http://localhost:9090
- 📈 **Grafana**: http://localhost:3001 (admin/mining123)

### Production Deployment (Raspberry Pi)

Deploy to Raspberry Pi using pre-built Docker images:

```bash
# Clone and deploy
git clone https://github.com/dvkorolev/mining-stack.git
cd mining-stack
chmod +x deploy-from-registry.sh
./deploy-from-registry.sh pi raspberrypi.local
```

**Access the dashboard:** http://raspberrypi.local:3000

📖 See **[Deployment Guide](./docs/DEPLOYMENT.md)** for detailed instructions.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React + Material-UI)         │
│              nginx + WebSocket proxy             │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│          Backend (Node.js + Express)             │
│         TypeScript + WebSocket Server            │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│            Monitoring Stack                      │
│  Prometheus + Grafana + Node Exporter            │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Mining Hardware                     │
│     ASICs discovered via pyasic scripts          │
└──────────────────────────────────────────────────┘
```

**Key Technologies:**
- **Frontend**: React 18, TypeScript, Material-UI, Chart.js
- **Backend**: Node.js, Express, WebSocket, TypeScript
- **Monitoring**: Prometheus, Grafana, Node Exporter
- **Deployment**: Docker, Docker Compose, GitHub Actions
- **Hardware Integration**: pyasic for ASIC miner discovery

## 📚 Documentation

### Getting Started
- **[🚀 Quick Start](./docs/QUICKSTART.md)** - Get up and running in 5 minutes
- **[📖 Deployment Guide](./docs/DEPLOYMENT.md)** - Production deployment to Raspberry Pi
- **[⚙️ Configuration](./docs/CONFIGURATION.md)** - Configure miners, monitoring, and alerts

### Operations
- **[🔍 Troubleshooting](./docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[🏥 Health Checks](./docs/HEALTH_CHECKS.md)** - Monitor system health
- **[📊 Monitoring](./docs/MONITORING.md)** - Prometheus, Grafana, and metrics

### Development
- **[🔌 API Reference](./docs/API.md)** - Backend API documentation
- **[🏗️ CI/CD Setup](./docs/CI_CD.md)** - GitHub Actions and automated deployment
- **[📝 Changelog](./CHANGELOG.md)** - Version history and updates

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details on:

- Code style guidelines
- Development workflow
- Pull request process
- Issue reporting

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
