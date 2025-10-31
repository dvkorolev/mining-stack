# Project Overview

## Mining Stack Monitor

A comprehensive, production-ready monitoring and control system for cryptocurrency mining operations.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User Interface                        │
│                    (React + Material-UI)                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ HTTP/WebSocket
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      Backend API                             │
│                   (Node.js + Express)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Mining     │  │  WebSocket   │  │    Config    │      │
│  │   Service    │  │   Service    │  │   Manager    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐  ┌──────▼──────┐  ┌───────▼────────┐
│   Prometheus   │  │   Grafana   │  │     Miners     │
│   (Metrics)    │  │ (Dashboards)│  │  (Hardware)    │
└────────────────┘  └─────────────┘  └────────────────┘
```

### Technology Stack

#### Frontend
- **Framework**: React 18.2
- **State Management**: Redux Toolkit
- **UI Library**: Material-UI (MUI) 5.13
- **Charts**: Chart.js, Recharts
- **HTTP Client**: Axios
- **Language**: TypeScript

#### Backend
- **Runtime**: Node.js
- **Framework**: Express 4.18
- **WebSocket**: ws 8.13
- **Language**: TypeScript
- **Logging**: Winston
- **Configuration**: dotenv, js-yaml

#### Infrastructure
- **Containerization**: Docker
- **Orchestration**: Docker Compose
- **Monitoring**: Prometheus
- **Visualization**: Grafana
- **Metrics Export**: Node Exporter

#### Development Tools
- **Build Tool**: TypeScript Compiler
- **Package Manager**: npm
- **Version Control**: Git

## Project Structure

```
mining-stack/
├── backend/                    # Backend application
│   ├── src/
│   │   ├── config/            # Configuration management
│   │   │   ├── config.ts      # App configuration
│   │   │   └── miners.config.ts # Miner configuration
│   │   ├── middleware/        # Express middleware
│   │   │   └── error.middleware.ts
│   │   ├── routes/            # API routes
│   │   │   └── mining.routes.ts
│   │   ├── services/          # Business logic
│   │   │   ├── mining.service.ts
│   │   │   └── websocket.service.ts
│   │   ├── utils/             # Utility functions
│   │   │   └── logger.ts
│   │   └── server.ts          # Application entry point
│   ├── Dockerfile             # Production Docker image
│   ├── Dockerfile.arm64       # ARM64 Docker image
│   ├── Dockerfile.dev         # Development Docker image
│   ├── package.json           # Dependencies
│   └── tsconfig.json          # TypeScript configuration
│
├── frontend/                   # Frontend application
│   ├── public/                # Static assets
│   ├── src/
│   │   ├── components/        # Reusable components
│   │   ├── features/          # Feature modules
│   │   │   └── mining/
│   │   │       └── miningSlice.ts
│   │   ├── pages/             # Page components
│   │   ├── services/          # API services
│   │   │   └── api.ts
│   │   ├── store/             # Redux store
│   │   └── App.tsx            # Root component
│   ├── Dockerfile             # Production Docker image
│   ├── package.json           # Dependencies
│   └── tsconfig.json          # TypeScript configuration
│
├── docker/                     # Docker configurations
│   ├── prometheus/            # Prometheus config
│   ├── alertmanager/          # Alertmanager config
│   └── blackbox/              # Blackbox exporter config
│
├── bin/                        # Utility scripts
│   ├── farm_init.py           # Miner discovery script
│   ├── pyasic_textfile.py     # Metrics collector
│   └── setup.sh               # Setup script
│
├── etc/                        # Configuration files
│   └── miners.yaml            # Miner definitions
│
├── docs/                       # Documentation
│   ├── API.md                 # API documentation
│   ├── CONFIGURATION.md       # Configuration guide
│   ├── TROUBLESHOOTING.md     # Troubleshooting guide
│   └── PROJECT_OVERVIEW.md    # This file
│
├── docker-compose.yml         # Production compose file
├── docker-compose.dev.yml     # Development compose file
├── deploy-pi.sh               # Raspberry Pi deployment
├── README.md                  # Main documentation
├── CONTRIBUTING.md            # Contribution guidelines
├── CHANGELOG.md               # Version history
└── RASPBERRY_PI_DEPLOYMENT.md # Pi deployment guide
```

## Core Features

### 1. Real-Time Monitoring
- Live hashrate tracking
- Miner status monitoring (online/offline/error)
- Hardware metrics (temperature, fan speed, power usage)
- Share statistics (accepted/rejected)
- Historical data visualization

### 2. Miner Management
- Start/stop mining operations
- Restart individual miners
- Update miner configurations
- Automatic miner discovery

### 3. Advanced Analytics
- Prometheus metrics collection
- Grafana dashboards
- Historical data analysis
- Performance trends

### 4. WebSocket Integration
- Real-time data updates
- Low-latency communication
- Automatic reconnection
- Connection health monitoring

### 5. Multi-Platform Support
- x86_64 architecture
- ARM64 (Raspberry Pi)
- Docker containerization
- Cross-platform compatibility

## Data Flow

### 1. Mining Statistics Collection

```
Miners → Mining Service → WebSocket → Frontend
   ↓
Prometheus ← Node Exporter
   ↓
Grafana
```

### 2. API Request Flow

```
Frontend → API Routes → Services → Miners
    ↓
Response ← Processing ← Data
```

### 3. WebSocket Update Flow

```
Mining Service (Interval) → Simulate Stats → Broadcast
                                ↓
                          WebSocket Server
                                ↓
                          Connected Clients
```

## Key Components

### Mining Service
- Manages mining operations
- Simulates miner statistics
- Broadcasts updates via WebSocket
- Handles miner configuration

### WebSocket Service
- Manages WebSocket connections
- Broadcasts real-time updates
- Handles client lifecycle
- Implements heartbeat mechanism

### Configuration Manager
- Loads miner configurations from YAML
- Manages environment variables
- Provides configuration access
- Validates configuration data

### API Routes
- RESTful endpoint definitions
- Request validation
- Error handling
- Response formatting

## Deployment Options

### 1. Development
```bash
docker compose -f docker-compose.dev.yml up
```
- Hot reloading
- Debug logging
- Development tools

### 2. Production
```bash
docker compose up -d --build
```
- Optimized builds
- Resource limits
- Production logging

### 3. Raspberry Pi
```bash
./deploy-pi.sh pi raspberrypi.local
```
- ARM64 images
- Resource optimization
- Edge deployment

## Security Considerations

### Current Implementation
- CORS configuration
- Helmet security headers
- Error handling
- Input validation

### Recommended Additions
- [ ] API authentication (JWT)
- [ ] Rate limiting
- [ ] HTTPS/TLS
- [ ] User authorization
- [ ] Audit logging
- [ ] Secrets management

## Performance Optimization

### Backend
- Resource limits in Docker
- Efficient data structures
- Configurable update intervals
- Memory management

### Frontend
- Code splitting
- Lazy loading
- Memoization
- Virtual scrolling

### Database
- In-memory storage (current)
- Future: PostgreSQL/MongoDB
- Caching strategies
- Query optimization

## Monitoring & Observability

### Metrics
- Application metrics (Prometheus)
- System metrics (Node Exporter)
- Custom business metrics
- Health checks

### Logging
- Structured logging (Winston)
- Log levels (error, warn, info, debug)
- Log rotation
- Centralized logging

### Alerting
- Prometheus Alertmanager
- Custom alert rules
- Notification channels
- Alert routing

## Future Enhancements

### Short Term
- [ ] User authentication
- [ ] Database persistence
- [ ] Email notifications
- [ ] API rate limiting
- [ ] Unit tests
- [ ] Integration tests

### Medium Term
- [ ] Mobile app
- [ ] Advanced analytics
- [ ] Pool integration
- [ ] Profitability calculator
- [ ] Energy tracking
- [ ] Automated backups

### Long Term
- [ ] Machine learning predictions
- [ ] Automated optimization
- [ ] Multi-region support
- [ ] Cloud deployment
- [ ] Kubernetes support
- [ ] Blockchain integration

## Development Workflow

### 1. Local Development
```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Start development servers
docker compose -f docker-compose.dev.yml up
```

### 2. Making Changes
```bash
# Create feature branch
git checkout -b feature/your-feature

# Make changes and test
npm test

# Commit and push
git commit -m "Add: your feature"
git push origin feature/your-feature
```

### 3. Testing
```bash
# Run tests
npm test

# Run linting
npm run lint

# Build project
npm run build
```

## Support & Resources

- **Documentation**: `/docs` directory
- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Contributing**: See CONTRIBUTING.md
- **Changelog**: See CHANGELOG.md

## License

MIT License - See LICENSE file for details

---

**Last Updated**: 2023-10-31
**Version**: 1.0.0
**Maintainer**: Mining Stack Team
