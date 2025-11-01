# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Telegram Bot Integration** - Complete bot for remote miner control and monitoring
  - Interactive command handlers (`/start`, `/status`, `/miners`, `/miner`, `/reboot`, `/alerts`, `/help`)
  - Inline keyboards and confirmation dialogs for safe operations
  - Custom keyboard shortcuts for quick access
  - Real-time alert notifications via Telegram
  - Miner reboot capability from Telegram
  - Detailed miner statistics on demand
  - Farm-wide status overview
- **Alert Management System** - Comprehensive alerting infrastructure
  - Alertmanager integration with webhook support
  - Alert history tracking and persistence
  - Per-miner alert filtering
  - Alert statistics dashboard
  - Automatic alert forwarding to Telegram
  - Severity-based alert routing (Critical/Warning/Info)
- **Alerts Page** - New frontend page for alert management
  - Real-time active alerts display
  - Alert history with filtering and sorting
  - Statistics cards (Active, Critical, Warning, 24h total)
  - Auto-refresh every 30 seconds
  - Tabbed interface (Active/History)
  - Severity indicators and color coding
- **Settings Page Enhancement** - Telegram bot configuration UI
  - Bot token and chat ID configuration
  - Real-time bot status monitoring
  - Test connection functionality
  - Embedded setup instructions
  - Command reference cards
  - Secure token input with show/hide toggle
- **Backend Services**
  - Telegram bot service with full command handling
  - Alert service for webhook processing and notification
  - 12 new API endpoints for Telegram and alert management
- **Documentation**
  - Complete Telegram bot setup guide (`TELEGRAM_SETUP.md`)
  - Comprehensive bot documentation (`docs/TELEGRAM_BOT.md`)
  - Implementation summary with architecture diagrams
- Comprehensive documentation structure
- API documentation with detailed endpoint descriptions
- Configuration guide with environment variables
- Troubleshooting guide for common issues
- Contributing guidelines
- WebSocket support for real-time updates
- Prometheus and Grafana integration
- Docker Compose setup for easy deployment
- Raspberry Pi deployment script
- Miner discovery using pyasic
- Multi-platform support (x86_64 and ARM64)

### Changed
- Enhanced Settings page from placeholder to full Telegram configuration
- Updated Sidebar navigation with Alerts menu item
- Extended mining routes with Telegram and alert endpoints
- Alertmanager configuration to support webhook notifications
- Improved README with better organization
- Enhanced project structure documentation
- Updated deployment instructions

### Fixed
- Added missing `node-telegram-bot-api` dependency to package.json
- TypeScript build errors in Telegram service
- Various bug fixes and improvements

## [1.0.0] - 2023-10-31

### Added
- Initial release
- Basic mining monitoring dashboard
- Real-time hashrate tracking
- Miner status monitoring
- Historical data visualization
- RESTful API for mining operations
- WebSocket support for live updates
- Docker containerization
- Material-UI based responsive interface

### Features
- Monitor multiple miners simultaneously
- Track hashrate, temperature, and power usage
- View mining statistics and history
- Start/stop/restart miners
- Configure miner settings
- Real-time alerts and notifications

## [0.1.0] - 2023-10-01

### Added
- Project initialization
- Basic backend structure
- Frontend scaffolding
- Docker configuration
- Initial documentation

---

## Release Notes

### Version 1.0.0

This is the first stable release of Mining Stack Monitor. It includes:

- **Complete monitoring solution** for cryptocurrency mining operations
- **Real-time updates** via WebSocket connections
- **Advanced analytics** with Prometheus and Grafana
- **Easy deployment** with Docker Compose
- **Raspberry Pi support** for edge deployment
- **Comprehensive documentation** for setup and usage

### Upgrade Guide

If you're upgrading from a pre-release version:

1. Backup your configuration files
2. Pull the latest changes
3. Rebuild Docker containers:
   ```bash
   docker compose down
   docker compose up -d --build
   ```
4. Update your miner configuration in `etc/miners.yaml`
5. Review the new documentation

### Breaking Changes

None in this release.

### Deprecations

None in this release.

---

## Future Plans

### Planned Features

- [ ] User authentication and authorization
- [ ] Multi-user support with role-based access
- [ ] Email/SMS notifications for alerts
- [ ] Mobile app for iOS and Android
- [ ] Advanced analytics and reporting
- [ ] Pool switching automation
- [ ] Profitability calculator
- [ ] Energy cost tracking
- [ ] API rate limiting
- [ ] Database persistence (PostgreSQL/MongoDB)
- [ ] Backup and restore functionality
- [ ] Custom dashboard widgets
- [ ] Export data to CSV/Excel
- [ ] Integration with mining pools
- [ ] Overclocking profiles
- [ ] Automated failover
- [ ] Machine learning for predictive maintenance

### Under Consideration

- Cloud deployment options (AWS, Azure, GCP)
- Kubernetes deployment
- Multi-region support
- Blockchain integration
- NFT minting for mining achievements
- Social features (leaderboards, sharing)

---

## Support

For issues, questions, or contributions, please visit:
- GitHub Issues: https://github.com/dvkorolev/mining-stack/issues
- Documentation: https://github.com/dvkorolev/mining-stack/docs

## Contributors

Thank you to all contributors who have helped make this project possible!

---

**Note**: This changelog is automatically updated with each release. For the most up-to-date information, please refer to the GitHub repository.
