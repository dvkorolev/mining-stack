# 📚 Documentation Structure

## Overview

This document describes the organized structure of all documentation in the Mining Stack project.

---

## 📁 Directory Structure

```
mining-stack/
├── README.md                          # Main project overview
├── CHANGELOG.md                       # Version history
├── DOCS_INDEX.md                      # Master documentation index
│
├── docs/                              # Main documentation directory
│   ├── README.md                      # Documentation hub
│   │
│   ├── getting-started/               # Getting started guides
│   │   ├── QUICKSTART.md             # 5-minute quick start
│   │   ├── INSTALLATION.md           # Detailed installation
│   │   └── CONFIGURATION.md          # Configuration guide
│   │
│   ├── deployment/                    # Deployment documentation
│   │   ├── DEPLOYMENT.md             # Production deployment
│   │   ├── RASPBERRY_PI.md           # Raspberry Pi specific
│   │   ├── CI_CD.md                  # GitHub Actions setup
│   │   └── DOCKER.md                 # Docker deployment
│   │
│   ├── features/                      # Feature-specific docs
│   │   ├── TELEGRAM_BOT.md           # Telegram bot guide
│   │   ├── MONITORING.md             # Monitoring setup
│   │   ├── THRESHOLDS.md             # Threshold configuration
│   │   ├── MOBILE_UI.md              # Mobile UI features
│   │   └── ANALYTICS.md              # Analytics features
│   │
│   ├── operations/                    # Operations guides
│   │   ├── HEALTH_CHECKS.md          # Health monitoring
│   │   ├── TROUBLESHOOTING.md        # Problem solving
│   │   ├── MAINTENANCE.md            # Maintenance tasks
│   │   └── MINING_FARM.md            # Large-scale operations
│   │
│   ├── development/                   # Developer documentation
│   │   ├── API.md                    # API reference
│   │   ├── ARCHITECTURE.md           # System architecture
│   │   ├── CONTRIBUTING.md           # Contribution guide
│   │   └── TESTING.md                # Testing strategy
│   │
│   └── archive/                       # Historical/archived docs
│       ├── implementation/            # Implementation summaries
│       ├── improvements/              # Improvement documents
│       └── deployment-guides/         # Old deployment guides
│
└── scripts/                           # Utility scripts
    └── docs/                          # Script documentation
```

---

## 📋 File Organization Rules

### Root Level (`/`)
- **Keep minimal**: Only essential files
- **README.md**: Main project overview
- **CHANGELOG.md**: Version history
- **DOCS_INDEX.md**: Master index to all docs

### Documentation Directory (`/docs/`)
- **Organized by category**: getting-started, deployment, features, operations, development
- **Clear naming**: Use descriptive, consistent names
- **Cross-references**: Link between related documents

### Archive Directory (`/docs/archive/`)
- **Historical documents**: Implementation summaries, old guides
- **Keep for reference**: Don't delete, but move out of main docs
- **Organized by type**: implementation/, improvements/, deployment-guides/

---

## 🗂️ Document Categories

### 1. Getting Started
**Purpose**: Help new users get up and running quickly

**Files**:
- `QUICKSTART.md` - 5-minute quick start
- `INSTALLATION.md` - Detailed installation steps
- `CONFIGURATION.md` - Initial configuration

**Audience**: New users, first-time installers

### 2. Deployment
**Purpose**: Production deployment guides

**Files**:
- `DEPLOYMENT.md` - General deployment guide
- `RASPBERRY_PI.md` - Raspberry Pi specific
- `CI_CD.md` - Automated deployment
- `DOCKER.md` - Docker deployment

**Audience**: System administrators, DevOps

### 3. Features
**Purpose**: Feature-specific documentation

**Files**:
- `TELEGRAM_BOT.md` - Telegram integration
- `MONITORING.md` - Monitoring setup
- `THRESHOLDS.md` - Alert thresholds
- `MOBILE_UI.md` - Mobile interface
- `ANALYTICS.md` - Analytics features

**Audience**: Users, operators

### 4. Operations
**Purpose**: Day-to-day operations and maintenance

**Files**:
- `HEALTH_CHECKS.md` - System health
- `TROUBLESHOOTING.md` - Problem solving
- `MAINTENANCE.md` - Regular maintenance
- `MINING_FARM.md` - Large-scale operations

**Audience**: Operators, administrators

### 5. Development
**Purpose**: Developer resources

**Files**:
- `API.md` - API reference
- `ARCHITECTURE.md` - System design
- `CONTRIBUTING.md` - How to contribute
- `TESTING.md` - Testing guide

**Audience**: Developers, contributors

### 6. Archive
**Purpose**: Historical reference

**Subdirectories**:
- `implementation/` - Implementation summaries
- `improvements/` - Improvement documents
- `deployment-guides/` - Old deployment guides

**Audience**: Developers, historians

---

## 📝 Naming Conventions

### File Names
- Use `UPPERCASE.md` for important root-level docs
- Use `Title_Case.md` or `UPPERCASE.md` in docs/
- Be descriptive: `TELEGRAM_BOT.md` not `BOT.md`
- Use underscores for multi-word: `HEALTH_CHECKS.md`

### Directory Names
- Use lowercase with hyphens: `getting-started/`
- Be descriptive: `deployment/` not `deploy/`
- Keep short but clear

---

## 🔗 Cross-Referencing

### Internal Links
```markdown
[Quick Start](./getting-started/QUICKSTART.md)
[API Reference](./development/API.md)
[Troubleshooting](./operations/TROUBLESHOOTING.md)
```

### Root Links
```markdown
[Main README](../README.md)
[Changelog](../CHANGELOG.md)
```

---

## ✅ Migration Plan

### Files to Move

**To `docs/development/`**:
- ARCHITECTURE.md
- TESTING_STRATEGY.md → TESTING.md

**To `docs/features/`**:
- MOBILE_UI_IMPROVEMENTS.md → MOBILE_UI.md
- PYASIC_SETUP.md
- THRESHOLD_CONFIGURATION.md → THRESHOLDS.md
- UNIVERSAL_COLLECTOR.md
- DUAL_COLLECTOR_SETUP.md

**To `docs/archive/implementation/`**:
- FINAL_IMPLEMENTATION_SUMMARY.md
- GHCR_V2_REVIEW.md
- HYBRID_COLLECTOR_SOLUTION.md
- IMPLEMENTATION_COMPLETE.md
- IMPLEMENTATION_SUMMARY.md
- METRICS_CONSOLIDATION_ANALYSIS.md
- PYASIC_GAPS_ANALYSIS.md
- THRESHOLD_INTEGRATION.md
- THRESHOLD_SYNC.md
- TIMESTAMP_CONSISTENCY_SOLUTION.md
- UNIVERSAL_COLLECTOR_CHECK.md
- V2_CHANGES_REVIEW.md
- V2_FINAL_SUMMARY.md

**To `docs/archive/improvements/`**:
- BACKEND_IMPROVEMENTS.md
- BULLETPROOF_IMPROVEMENTS.md
- COMPLETE_STACK_IMPROVEMENTS.md
- FRONTEND_IMPROVEMENTS.md
- WEBUI_IMPROVEMENTS.md

**To `docs/archive/deployment-guides/`**:
- DEPLOYMENT_FIX_GUIDE.md
- DEPLOY_COMPLETE.md
- DEPLOY_NOW.md
- DEPLOY_V2.md
- PRODUCTION_READY.md
- READY_TO_DEPLOY.md
- REBUILD_INSTRUCTIONS.md

**To `docs/archive/troubleshooting/`**:
- RASPI_HEALTH_CHECK_RESULTS.md
- THRESHOLD_UPDATE_FIX.md

**To `docs/archive/`**:
- SCRIPTS_ORGANIZED.md

---

**Last Updated**: November 3, 2025  
**Status**: Structure defined, ready for migration
