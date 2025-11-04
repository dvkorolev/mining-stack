# Mining Stack Documentation

Welcome to the Mining Stack documentation! This guide will help you set up, configure, and operate your mining monitoring system.

## 📚 Documentation Index

### Getting Started

- **[🚀 Quick Start](./deployment/QUICKSTART.md)**  
  Get up and running in 5 minutes with local development or Raspberry Pi deployment.

- **[📖 Deployment Guide](./deployment/DEPLOYMENT.md)**  
  Complete guide for production deployment to Raspberry Pi using pre-built Docker images.

- **[⚙️ Configuration](./reference/CONFIGURATION.md)**  
  Configure miners, monitoring, alerts, and system settings.

- **[📋 Overview](./reference/OVERVIEW.md)**  
  System architecture and capabilities overview.

### API Documentation

- **[🔌 API Reference](./api/API.md)**  
  Complete backend API documentation with endpoints, request/response formats.

- **[🔄 Reboot API](./api/API_REBOOT_REFERENCE.md)**  
  Miner reboot and control API reference.

### Operations & Maintenance

- **[🔍 Troubleshooting](./operations/TROUBLESHOOTING.md)**  
  Common issues and their solutions. Check here first if something isn't working.

- **[🏥 Health Checks](./operations/HEALTH_CHECKS.md)**  
  Monitor system health, set up automated checks, and understand health metrics.

- **[📊 Monitoring](./operations/MONITORING.md)**  
  Set up Prometheus and Grafana for advanced monitoring, metrics, and alerting.

- **[📈 Grafana Dashboards](./operations/GRAFANA_DASHBOARDS.md)**  
  Dashboard setup and visualization guide.

- **[🤖 Telegram Bot](./operations/TELEGRAM_BOT.md)**  
  Complete guide for Telegram bot integration - remote miner control, alerts, and monitoring.

- **[🏭 Mining Farm Setup](./operations/MINING_FARM.md)**  
  Best practices for managing large-scale mining operations.

### Deployment & CI/CD

- **[🚀 Production Setup](./deployment/PRODUCTION_SETUP.md)**  
  Production deployment best practices.

- **[🏗️ CI/CD Setup](./deployment/CI_CD.md)**  
  Set up GitHub Actions for automated building and deployment.

- **[📦 Deployment Summary](./deployment/DEPLOYMENT_SUMMARY.md)**  
  Quick deployment reference.

### Reference

- **[📊 Metrics Collection](./reference/METRICS_COLLECTION.md)**  
  Understanding metrics and data collection.

- **[🔍 Miner Discovery](./reference/MINER_DISCOVERY.md)**  
  How miner discovery works.

- **[⚙️ Thresholds](./reference/THRESHOLDS.md)**  
  Alert threshold configuration.

### Features & Enhancements

- **[🐳 Docker Improvements](./features/DOCKER_IMPROVEMENTS.md)**  
  Multi-stage builds, platform flexibility, and optimization details.

- **[📊 Monitoring Stack](./features/MONITORING_IMPROVEMENTS.md)**  
  Blackbox Exporter, Telegram alerts, and Grafana dashboard templates.

- **[🏊 Pool Management](./features/POOLS_INTEGRATION_PROGRESS.md)**  
  Complete pools.yaml integration with UI management.

### Architecture & Design

- **[🔗 Cross-Service Logging](./architecture/CROSS_SERVICE_LOGGING.md)**  
  Unified logging architecture across all services.

- **[📝 Log Service Design](./architecture/LOG_SERVICE_DESIGN.md)**  
  Structured logging design and implementation.

- **[🏗️ Logging Architecture](./architecture/LOGGING_ARCHITECTURE_REFACTOR.md)**  
  Logging refactor and best practices.

### Guides

- **[📚 Logging Quickstart](./guides/LOGGING_QUICKSTART.md)**  
  Quick guide to logging configuration and usage.

- **[📦 Dependency Check](./guides/DEPENDENCY_CHECK.md)**  
  Verification of all project dependencies.

- **[🔍 Dependencies Status](./guides/DEPENDENCIES_STATUS.md)**  
  Current status of all dependencies.

## Quick Links

### Common Tasks

- **Add a new miner**: See [Configuration Guide](./reference/CONFIGURATION.md#adding-miners)
- **Set up Telegram bot**: See [Telegram Bot Guide](./operations/TELEGRAM_BOT.md)
- **Update the system**: See [Deployment Guide](./deployment/DEPLOYMENT.md#updating)
- **View logs**: See [Troubleshooting](./operations/TROUBLESHOOTING.md#checking-logs)
- **Set up alerts**: See [Monitoring Guide](./operations/MONITORING.md#alerting)

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  Frontend (React)                │
│         nginx + WebSocket proxy + Alerts         │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Backend (Node.js)                   │
│    Express + WebSocket + Telegram Bot Service   │
└──────────────────┬──────────────────────────────┘
                   │                               │
                   │                    ┌──────────▼──────────┐
                   │                    │   Telegram Bot API  │
                   │                    │  (Remote Control &  │
                   │                    │   Notifications)    │
                   │                    └─────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│            Monitoring Stack                      │
│  Prometheus + Grafana + Alertmanager + Exporter │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Mining Hardware                     │
│     ASICs discovered via pyasic scripts          │
└──────────────────────────────────────────────────┘
```

## Support

- **Issues**: [GitHub Issues](https://github.com/dvkorolev/mining-stack/issues)
- **Discussions**: [GitHub Discussions](https://github.com/dvkorolev/mining-stack/discussions)
- **Changelog**: [CHANGELOG.md](../CHANGELOG.md)

## Contributing

We welcome contributions! Please see our [Contributing Guide](../CONTRIBUTING.md) for:
- Code style guidelines
- Development workflow
- Pull request process
- Issue reporting

---

**Need help?** Start with the [🚀 Quick Start Guide](./QUICKSTART.md) or check [🔍 Troubleshooting](./TROUBLESHOOTING.md).
