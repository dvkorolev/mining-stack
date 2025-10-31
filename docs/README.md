# Mining Stack Documentation

Welcome to the Mining Stack documentation! This guide will help you set up, configure, and operate your mining monitoring system.

## 📚 Documentation Index

### Getting Started

- **[🚀 Quick Start](./QUICKSTART.md)**  
  Get up and running in 5 minutes with local development or Raspberry Pi deployment.

- **[📖 Deployment Guide](./DEPLOYMENT.md)**  
  Complete guide for production deployment to Raspberry Pi using pre-built Docker images.

- **[⚙️ Configuration](./CONFIGURATION.md)**  
  Configure miners, monitoring, alerts, and system settings.

### Operations & Maintenance

- **[🔍 Troubleshooting](./TROUBLESHOOTING.md)**  
  Common issues and their solutions. Check here first if something isn't working.

- **[🏥 Health Checks](./HEALTH_CHECKS.md)**  
  Monitor system health, set up automated checks, and understand health metrics.

- **[📊 Monitoring](./MONITORING.md)**  
  Set up Prometheus and Grafana for advanced monitoring, metrics, and alerting.

- **[🏭 Mining Farm Setup](./MINING_FARM.md)**  
  Best practices for managing large-scale mining operations.

### Development

- **[🔌 API Reference](./API.md)**  
  Complete backend API documentation with endpoints, request/response formats.

- **[🏗️ CI/CD Setup](./CI_CD.md)**  
  Set up GitHub Actions for automated building and deployment.

## Quick Links

### Common Tasks

- **Add a new miner**: See [Configuration Guide](./CONFIGURATION.md#adding-miners)
- **Update the system**: See [Deployment Guide](./DEPLOYMENT.md#updating)
- **View logs**: See [Troubleshooting](./TROUBLESHOOTING.md#checking-logs)
- **Set up alerts**: See [Monitoring Guide](./MONITORING.md#alerting)

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  Frontend (React)                │
│              nginx + WebSocket proxy             │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Backend (Node.js)                   │
│         Express + WebSocket Server               │
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
