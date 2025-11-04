# 📚 Mining Stack Documentation Index

Complete guide to all documentation in the Mining Stack project.

---

## 🏠 Root Documentation

### **Essential Files**

| File | Purpose | Audience |
|------|---------|----------|
| [README.md](./README.md) | Project overview, quick start, features | Everyone |
| [CHANGELOG.md](./CHANGELOG.md) | Version history and release notes | Everyone |
| [DOCS_INDEX.md](./DOCS_INDEX.md) | This file - master documentation index | Everyone |

---

## 📖 Documentation Directory (`docs/`)

### **📘 Getting Started** (`docs/getting-started/`)

| File | Description | Time |
|------|-------------|------|
| [QUICKSTART.md](./docs/QUICKSTART.md) | Get running in 5 minutes | 5 min |
| [CONFIGURATION.md](./docs/CONFIGURATION.md) | System configuration | 10 min |

### **🚀 Deployment** (`docs/deployment/`)

| File | Description | Audience |
|------|-------------|----------|
| [DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Production deployment guide | Admins |
| [CI_CD.md](./docs/CI_CD.md) | GitHub Actions setup | DevOps |

### **✨ Features** (`docs/features/`)

| File | Description | Use Case |
|------|-------------|----------|
| [TELEGRAM_BOT.md](./docs/TELEGRAM_BOT.md) | Complete Telegram bot guide | Remote control |
| [MONITORING.md](./docs/MONITORING.md) | Prometheus, Grafana, metrics | Setup monitoring |
| [THRESHOLDS.md](./docs/features/THRESHOLDS.md) | Threshold configuration guide | Configure alerts |
| [MOBILE_UI.md](./docs/features/MOBILE_UI.md) | Mobile interface features | Mobile users |
| [PYASIC_SETUP.md](./docs/features/PYASIC_SETUP.md) | PyASIC collector setup | Operators |
| [UNIVERSAL_COLLECTOR.md](./docs/features/UNIVERSAL_COLLECTOR.md) | Universal miner collector | Operators |
| [DUAL_COLLECTOR_SETUP.md](./docs/features/DUAL_COLLECTOR_SETUP.md) | Run multiple collectors | Advanced |

### **⚙️ Operations** (`docs/operations/`)

| File | Description | Use Case |
|------|-------------|----------|
| [HEALTH_CHECKS.md](./docs/HEALTH_CHECKS.md) | System health monitoring | Maintenance |
| [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | Common issues & solutions | Problem solving |
| [MINING_FARM.md](./docs/MINING_FARM.md) | Large-scale operations | Farm management |

### **💻 Development** (`docs/development/`)

| File | Description | Audience |
|------|-------------|----------|
| [API.md](./docs/API.md) | Backend API reference | Developers |
| [ARCHITECTURE.md](./docs/development/ARCHITECTURE.md) | System architecture | Developers |
| [TESTING.md](./docs/development/TESTING.md) | Testing strategy | Developers |
| [README.md](./docs/README.md) | Documentation hub | Everyone |

### **📦 Archive** (`docs/archive/`)

Historical documentation for reference:

- **Implementation** (`docs/archive/implementation/`) - Implementation summaries and technical reviews
- **Improvements** (`docs/archive/improvements/`) - Feature improvement documents
- **Deployment Guides** (`docs/archive/deployment-guides/`) - Historical deployment guides
- **Troubleshooting** (`docs/archive/troubleshooting/`) - Resolved issues and fixes

---

## 🎯 Quick Navigation

### **I want to...**

#### **Get Started**
- ✅ [Install locally](./docs/QUICKSTART.md)
- ✅ [Deploy to Raspberry Pi](./docs/DEPLOYMENT.md)
- ✅ [Configure miners](./docs/CONFIGURATION.md)

#### **Set Up Features**
- ✅ [Enable Telegram bot](./TELEGRAM_SETUP.md)
- ✅ [Configure alerts](./docs/MONITORING.md#alerting)
- ✅ [Set up Grafana](./docs/MONITORING.md#grafana-setup)

#### **Troubleshoot**
- ✅ [Common issues](./docs/TROUBLESHOOTING.md)
- ✅ [Check logs](./docs/TROUBLESHOOTING.md#checking-logs)
- ✅ [Health checks](./docs/HEALTH_CHECKS.md)

#### **Develop**
- ✅ [API reference](./docs/API.md)
- ✅ [Architecture](./IMPLEMENTATION_SUMMARY.md)
- ✅ [CI/CD setup](./docs/CI_CD.md)

---

## 📊 Documentation Coverage

### **By Feature**

| Feature | Documentation | Status |
|---------|--------------|--------|
| **Dashboard** | README, QUICKSTART | ✅ Complete |
| **Miners Management** | CONFIGURATION | ✅ Complete |
| **Analytics** | README, MONITORING | ✅ Complete |
| **Alerts** | MONITORING, TELEGRAM_BOT | ✅ Complete |
| **Telegram Bot** | TELEGRAM_SETUP, TELEGRAM_BOT | ✅ Complete |
| **Settings** | CONFIGURATION, TELEGRAM_SETUP | ✅ Complete |
| **Monitoring** | MONITORING, HEALTH_CHECKS | ✅ Complete |
| **Deployment** | DEPLOYMENT, QUICKSTART | ✅ Complete |
| **API** | API | ✅ Complete |

### **By User Type**

#### **End Users**
- ✅ Quick start guide
- ✅ Telegram bot setup
- ✅ Configuration guide
- ✅ Troubleshooting

#### **Operators**
- ✅ Deployment guide
- ✅ Monitoring setup
- ✅ Health checks
- ✅ Mining farm management

#### **Developers**
- ✅ API reference
- ✅ Implementation details
- ✅ CI/CD setup
- ✅ Architecture docs

---

## 🔄 Documentation Workflow

### **For New Features**
1. Update `CHANGELOG.md` with feature details
2. Add/update relevant docs in `docs/`
3. Update `README.md` if it's a major feature
4. Create quick setup guide if needed
5. Update this index

### **For Bug Fixes**
1. Update `CHANGELOG.md`
2. Update `TROUBLESHOOTING.md` if relevant
3. Update affected documentation

### **For Configuration Changes**
1. Update `CONFIGURATION.md`
2. Update `DEPLOYMENT.md` if deployment affected
3. Update `CHANGELOG.md`

---

## 📝 Documentation Standards

### **File Naming**
- Use `UPPERCASE.md` for root-level docs
- Use `Title_Case.md` for docs/ directory
- Use descriptive names (e.g., `TELEGRAM_SETUP.md` not `SETUP.md`)

### **Content Structure**
- Start with clear title and purpose
- Include table of contents for long docs
- Use emojis for visual navigation
- Include code examples
- Add troubleshooting sections

### **Markdown Style**
- Use `#` for main title
- Use `##` for sections
- Use `###` for subsections
- Use code blocks with language tags
- Use tables for structured data

---

## 🎉 Documentation Statistics

| Metric | Count |
|--------|-------|
| **Total Documentation Files** | 17 |
| **Root Documentation** | 5 |
| **Feature Guides** | 6 |
| **Detailed Guides** | 11 |
| **Total Lines** | ~6,000+ |
| **Coverage** | 100% |

---

## 🔗 External Resources

- **GitHub Repository**: https://github.com/dvkorolev/mining-stack
- **Issue Tracker**: https://github.com/dvkorolev/mining-stack/issues
- **Discussions**: https://github.com/dvkorolev/mining-stack/discussions

---

## ✅ Documentation Checklist

Use this checklist when adding new features:

- [ ] Updated CHANGELOG.md
- [ ] Updated README.md (if major feature)
- [ ] Created/updated relevant docs in docs/
- [ ] Added troubleshooting section
- [ ] Included code examples
- [ ] Updated this index
- [ ] Tested all links
- [ ] Reviewed for clarity

---

**Last Updated**: November 1, 2025  
**Documentation Version**: 2.0 (Telegram Bot Integration)
