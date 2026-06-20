# Mining Stack Monitor 🚀

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)](https://reactjs.org/)

**One dashboard to monitor and control your entire mining farm.**

A comprehensive monitoring and control system for cryptocurrency mining operations. Monitor 20+ miners from a single interface, get instant alerts, analyze performance trends, and control everything remotely. Built with React, Node.js, and Docker. Designed to run on a Raspberry Pi.

**📖 [Read the Complete Overview](docs/reference/OVERVIEW.md)** - Understand the full system architecture and capabilities

## ✨ Features

### Core Monitoring
- **Real-time Monitoring**: Track mining statistics (hashrate, active miners, total mined)
- **Historical Data**: Beautiful charts and graphs for performance analysis
- **WebSocket Support**: Real-time updates without page refreshes
- **Responsive Design**: Material-UI based interface that works on desktop and mobile

### Remote Control & Alerts
- **🤖 Telegram Bot Integration**: Control miners and receive alerts via Telegram
  - Remote miner reboot with confirmation dialogs
  - Real-time farm statistics on demand
  - Interactive command interface with inline keyboards
  - Automatic alert notifications
- **🔔 Alert Management**: Comprehensive alerting system
  - Active alerts dashboard with real-time updates
  - Alert history tracking and filtering
  - Integration with Prometheus Alertmanager
  - Severity-based routing (Critical/Warning/Info)

### Infrastructure
- **Dockerized**: Easy deployment with Docker Compose
- **Smart CI/CD**: Intelligent builds that only update changed services (60% faster)
- **Advanced Monitoring**: Integrated with Prometheus and Grafana for metrics and alerting
- **Miner Discovery**: Automatically detect miners on your network using pyasic
- **Multi-Platform**: Supports x86_64 and ARM64 (Raspberry Pi)
- **Zero Downtime**: Smart deployments keep unchanged services running

## 📚 Documentation

**[📖 Complete Documentation Index](docs/README.md)**

### Getting Started
- **[🚀 Quick Start](docs/deployment/QUICKSTART.md)** - Get running in 5 minutes
- **[📦 Deployment Guide](docs/deployment/DEPLOYMENT.md)** - Production deployment to Raspberry Pi
- **[⚡ Smart CI/CD](docs/deployment/SMART_CICD.md)** - Build only what changed (60% faster!)
- **[🔧 Configuration](docs/reference/CONFIGURATION.md)** - Miners, monitoring, and alerts

### Operations
- **[🔍 Troubleshooting](docs/operations/TROUBLESHOOTING.md)** - Common issues and solutions
- **[🏥 Health Checks](docs/operations/HEALTH_CHECKS.md)** - Monitor system health
- **[📊 Monitoring](docs/operations/MONITORING.md)** - Prometheus, Grafana, and metrics
- **[🤖 Telegram Bot](docs/operations/TELEGRAM_BOT.md)** - Setup and commands

### Reference & Development
- **[📖 System Overview](docs/reference/OVERVIEW.md)** - Architecture and capabilities
- **[🔌 API Reference](docs/api/API.md)** - Backend API documentation
- **[🏗️ CI/CD Setup](docs/deployment/CI_CD.md)** - GitHub Actions and automated deployment
- **[📝 Changelog](docs/changelog/CHANGELOG.md)** - Version history and updates

### Component Documentation
- **[Backend Service](backend/README.md)** - Node.js/Express API server
- **[Frontend Service](frontend/README.md)** - React web interface
- **[Python Scheduler](python-scheduler/README.md)** - Metrics collection service
- **[Docker Configuration](docker/README.md)** - Prometheus, Grafana, Alertmanager

## 📋 Prerequisites

- Docker (v20.10+)
- Docker Compose (v2.0+)
- Node.js (v16+) - Only needed for local development without Docker
- Python 3.8+ (for miner discovery scripts)

## 🚀 Quick Start

### Run the Full Stack (Docker)

```bash
# 1. Clone the repository
git clone https://github.com/dvkorolev/mining-stack.git
cd mining-stack

# 2. Start all services (uses docker-compose.prod.yml)
make up
```

> For local per-service development (hot reload), see the per-service commands in
> [CLAUDE.md](CLAUDE.md#commands) (`npm run dev`, `npm start`, `python main.py`).

**Access the services:**
- 🌐 **Frontend**: http://localhost:3000
- ⚙️ **Backend API**: http://localhost:5000
- 📊 **Prometheus**: http://localhost:9090
- 📈 **Grafana**: http://localhost:3001 (admin / <your GF_SECURITY_ADMIN_PASSWORD>)
- 🔔 **Alertmanager**: http://localhost:9093

**Optional: Set up Telegram Bot** (see [Telegram Configuration](./TELEGRAM_CONFIGURATION.md))
```bash
# Add to .env file
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_ENABLED=true
```

### Production Deployment (Raspberry Pi)

Deploy to Raspberry Pi using locally built Docker images:

```bash
# Clone repository
git clone https://github.com/dvkorolev/mining-stack.git
cd mining-stack

# Build and deploy (smart - only transfers changes)
./quick-deploy.sh
```

**Access the dashboard:** http://192.168.1.66:3000

📖 See the **[Deployment Guide](./DEPLOYMENT.md)** for detailed instructions.

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

## Contributing

Contributions are welcome — please open an issue or a pull request on
[GitHub](https://github.com/dvkorolev/mining-stack). Work on a dedicated branch off `main`
and keep changes small and reversible (see [CLAUDE.md](CLAUDE.md) for the working conventions).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
