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

### Raspberry Pi Deployment

For detailed Raspberry Pi deployment instructions, see [RASPBERRY_PI_DEPLOYMENT.md](./RASPBERRY_PI_DEPLOYMENT.md).

**Quick deployment:**

```bash
chmod +x deploy-pi.sh
./deploy-pi.sh pi raspberrypi.local
```

### Production Deployment

1. **Configure environment variables**:
   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env with your production settings
   ```

2. **Build and start the containers**:
   ```bash
   docker compose up -d --build
   ```

3. **Access the application**:
   - Frontend: http://your-server-ip:3000
   - Grafana: http://your-server-ip:3001

## Project Structure

```
mining-stack/
├── backend/               # Node.js backend
│   ├── src/               # Source code
│   │   ├── config/        # Configuration files
│   │   ├── controllers/   # Request handlers
│   │   ├── middleware/    # Express middleware
│   │   ├── models/        # Data models
│   │   ├── routes/        # API routes
│   │   ├── services/      # Business logic
│   │   ├── server.ts      # Entry point
│   │   └── ...
│   ├── Dockerfile         # Production Dockerfile
│   ├── Dockerfile.dev     # Development Dockerfile
│   ├── package.json       # Backend dependencies
│   └── tsconfig.json      # TypeScript config
│
├── frontend/              # React frontend
│   ├── public/            # Static files
│   ├── src/               # Source code
│   │   ├── components/    # Reusable UI components
│   │   ├── features/      # Feature modules
│   │   ├── pages/         # Page components
│   │   ├── services/      # API services
│   │   ├── store/         # Redux store
│   │   ├── App.tsx        # Main app component
│   │   └── ...
│   ├── Dockerfile         # Production Dockerfile
│   ├── package.json       # Frontend dependencies
│   └── tsconfig.json      # TypeScript config
│
├── docker/                # Docker configuration
│   └── prometheus/        # Prometheus config
├── docker-compose.yml     # Production compose file
├── docker-compose.dev.yml # Development compose file
└── README.md             # This file
```

## API Endpoints

### Mining

- `GET /api/mining/stats` - Get current mining statistics
- `POST /api/mining/start` - Start mining
- `POST /api/mining/stop` - Stop mining
- `POST /api/mining/restart/:minerId` - Restart a specific miner
- `PUT /api/mining/config/:minerId` - Update miner configuration

### Health

- `GET /health` - Health check endpoint

## WebSocket Events

The application uses WebSockets for real-time updates. The following events are available:

- `mining-stats` - Emitted when mining statistics are updated

## Monitoring

The application includes Prometheus and Grafana for advanced monitoring:

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/mining123)

When deployed on the Pi in a local network, expose ports on the Pi's LAN IP (or restrict access via your router/firewall).

## Documentation

For detailed documentation, please refer to:

- [API Documentation](./docs/API.md) - Complete API reference
- [Configuration Guide](./docs/CONFIGURATION.md) - Environment variables and settings
- [Troubleshooting](./docs/TROUBLESHOOTING.md) - Common issues and solutions
- [Raspberry Pi Deployment](./RASPBERRY_PI_DEPLOYMENT.md) - Detailed Pi deployment guide

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details on:

- Code style guidelines
- Development workflow
- Pull request process
- Issue reporting

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
