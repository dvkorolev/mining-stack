# Logging Architecture Refactor

## Problem Statement

Currently, logging configuration is **duplicated** across services:
- `python-scheduler/logging_config.py` (Python)
- `backend/src/utils/logger.ts` (TypeScript)
- `frontend/src/utils/logger.ts` (TypeScript)

This leads to:
- ❌ Code duplication
- ❌ Inconsistency risk
- ❌ Maintenance burden

## Solution: Shared Logging Libraries

Create **shared libraries** that all services can import.

## Recommended Architecture

```
mining-stack/
├── shared-libs/
│   ├── python-logging/           ← Shared Python logging
│   │   ├── setup.py
│   │   ├── mining_logging/
│   │   │   ├── __init__.py
│   │   │   ├── formatters.py
│   │   │   ├── handlers.py
│   │   │   └── config.py
│   │   └── README.md
│   │
│   └── ts-logging/               ← Shared TypeScript logging
│       ├── package.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── formatters.ts
│       │   └── logger.ts
│       └── README.md
│
├── python-scheduler/
│   ├── requirements.txt          ← Add: mining-logging==1.0.0
│   └── main.py                   ← Import: from mining_logging import setup_logging
│
├── backend/
│   ├── package.json              ← Add: "@mining-stack/logging": "^1.0.0"
│   └── src/server.ts             ← Import: import { logger } from '@mining-stack/logging'
│
└── frontend/
    ├── package.json              ← Add: "@mining-stack/logging": "^1.0.0"
    └── src/App.tsx               ← Import: import { logger } from '@mining-stack/logging'
```

## Implementation

### Option 1: Monorepo with Shared Packages (Recommended)

#### Structure
```
mining-stack/
├── packages/
│   ├── python-logging/
│   ├── ts-logging/
│   └── common-types/
├── services/
│   ├── python-scheduler/
│   ├── backend/
│   └── frontend/
└── docker-compose.yml
```

#### Benefits
- ✅ Single repository
- ✅ Easy to keep in sync
- ✅ Shared CI/CD
- ✅ Atomic changes across services

#### Tools
- **Python**: Use workspace with `pip install -e ../packages/python-logging`
- **TypeScript**: Use npm/yarn workspaces or pnpm
- **Monorepo tool**: Nx, Turborepo, or Lerna

### Option 2: Separate Package Repositories

#### Structure
```
mining-logging-py/          (GitHub repo)
├── setup.py
└── mining_logging/

@mining-stack/logging/      (GitHub repo / npm package)
├── package.json
└── src/

mining-stack/               (Main repo)
├── python-scheduler/
│   └── requirements.txt    ← mining-logging==1.0.0
├── backend/
│   └── package.json        ← "@mining-stack/logging": "^1.0.0"
└── frontend/
    └── package.json        ← "@mining-stack/logging": "^1.0.0"
```

#### Benefits
- ✅ Independent versioning
- ✅ Can be open-sourced
- ✅ Used by other projects
- ✅ Clear separation of concerns

#### Drawbacks
- ❌ More complex to develop
- ❌ Need to publish packages
- ❌ Version management overhead

### Option 3: Keep Current (Acceptable for Small Teams)

#### When It's OK
- ✅ Small team (1-3 developers)
- ✅ Low change frequency
- ✅ Services in different languages anyway
- ✅ Team can keep them in sync manually

#### When It's NOT OK
- ❌ Growing team
- ❌ Frequent logging changes
- ❌ Multiple teams working on different services
- ❌ Already seeing drift between services

## Recommended Implementation: Monorepo

### Step 1: Create Shared Python Logging Package

```bash
mkdir -p shared-libs/python-logging/mining_logging
cd shared-libs/python-logging
```

**setup.py**:
```python
from setuptools import setup, find_packages

setup(
    name="mining-logging",
    version="1.0.0",
    packages=find_packages(),
    install_requires=[
        "python-json-logger>=2.0.0",
    ],
    author="Mining Stack Team",
    description="Shared logging configuration for mining-stack services",
)
```

**mining_logging/__init__.py**:
```python
"""
Mining Stack Logging Library
Provides consistent structured logging across all Python services
"""

from .config import setup_logging, get_logger
from .context import LogContext
from .helpers import log_event

__version__ = "1.0.0"

__all__ = [
    'setup_logging',
    'get_logger',
    'LogContext',
    'log_event',
]
```

**mining_logging/config.py**:
```python
# Move your logging_config.py content here
# ... (same code as before)
```

### Step 2: Create Shared TypeScript Logging Package

```bash
mkdir -p shared-libs/ts-logging/src
cd shared-libs/ts-logging
```

**package.json**:
```json
{
  "name": "@mining-stack/logging",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest"
  },
  "dependencies": {
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
```

**src/index.ts**:
```typescript
export { logger, logEvent } from './logger';
export { LogLevel } from './types';
export * from './formatters';
```

**src/logger.ts**:
```typescript
// Move your logger.ts content here
// ... (same code as before)
```

### Step 3: Update Services to Use Shared Libraries

#### Python Scheduler

**requirements.txt**:
```txt
# Add local package in development
-e ../shared-libs/python-logging

# Or in production (if published to PyPI)
mining-logging==1.0.0
```

**main.py**:
```python
# Before
from logging_config import setup_logging, log_event

# After
from mining_logging import setup_logging, log_event

# Everything else stays the same!
```

#### Backend

**package.json**:
```json
{
  "dependencies": {
    "@mining-stack/logging": "file:../../shared-libs/ts-logging"
  }
}
```

**server.ts**:
```typescript
// Before
import { logger, logEvent } from './utils/logger';

// After
import { logger, logEvent } from '@mining-stack/logging';

// Everything else stays the same!
```

#### Frontend

Same as backend - just import from shared package.

### Step 4: Setup Monorepo (Optional but Recommended)

**Using pnpm workspaces** (recommended for TypeScript):

**pnpm-workspace.yaml** (root):
```yaml
packages:
  - 'shared-libs/*'
  - 'services/*'
```

**Using Python workspace**:

**pyproject.toml** (root):
```toml
[tool.poetry]
name = "mining-stack"
version = "1.0.0"

[tool.poetry.dependencies]
python = "^3.9"

[tool.poetry.group.dev.dependencies]
mining-logging = {path = "shared-libs/python-logging", develop = true}
```

## Migration Path

### Phase 1: Extract to Shared Libs (1-2 hours)
1. Create `shared-libs/python-logging/`
2. Move `logging_config.py` → `mining_logging/config.py`
3. Add `setup.py`
4. Test locally

### Phase 2: Update Python Services (30 minutes)
1. Update `requirements.txt`
2. Change imports
3. Test

### Phase 3: Extract TypeScript Logging (1 hour)
1. Create `shared-libs/ts-logging/`
2. Move logger code
3. Add `package.json`
4. Build and test

### Phase 4: Update TypeScript Services (30 minutes)
1. Update `package.json` in backend/frontend
2. Change imports
3. Test

### Phase 5: Setup CI/CD (1 hour)
1. Build shared libs first
2. Then build services
3. Publish packages (optional)

## Comparison

| Aspect | Current | Shared Libs | Separate Repos |
|--------|---------|-------------|----------------|
| Code duplication | ❌ High | ✅ None | ✅ None |
| Consistency | ❌ Manual | ✅ Automatic | ✅ Automatic |
| Maintenance | ❌ 3x work | ✅ 1x work | ⚠️ 1x + versioning |
| Setup complexity | ✅ Simple | ⚠️ Medium | ❌ Complex |
| Development speed | ✅ Fast | ✅ Fast | ⚠️ Slower |
| Team size | ✅ 1-2 | ✅ 2-10 | ✅ 10+ |

## Recommendation for Your Mining-Stack

### Now (If team < 3 people)
**Keep current approach** ✅
- It's working
- Easy to understand
- Low overhead
- **BUT**: Document the format clearly

### Soon (If team growing or frequent changes)
**Move to monorepo with shared libs** ✅
- Better organization
- Single source of truth
- Easy to keep in sync
- Not too complex

### Later (If multiple teams or open-sourcing)
**Separate package repositories** ✅
- Independent versioning
- Can be shared with community
- Professional setup

## Quick Win: Document the Contract

Even if you keep current approach, **document the logging contract**:

**LOGGING_CONTRACT.md**:
```markdown
# Logging Contract

All services MUST output logs in this format:

## JSON Structure
```json
{
  "timestamp": "ISO 8601 UTC",
  "level": "DEBUG|INFO|WARNING|ERROR|CRITICAL",
  "service": "service-name",
  "logger": "module-name",
  "message": "string",
  "hostname": "string",
  "extra": {}  // optional
}
```

## Field Requirements
- `timestamp`: MUST be ISO 8601 UTC
- `level`: MUST be uppercase
- `service`: MUST match service name
- All extra fields: MUST use snake_case

## Testing
Run: `docker logs <service> --tail 5 | jq`
Should parse without errors.
```

## Conclusion

**Your current approach is OK for now**, but:

### ✅ It's Acceptable If:
- Small team (1-3 people)
- Low change frequency
- You can keep them in sync manually

### ❌ Refactor to Shared Libs If:
- Team is growing
- Logging changes frequently
- Already seeing inconsistencies
- Want to enforce standards

### 🎯 My Recommendation:
1. **Now**: Keep current, but document the contract
2. **Next sprint**: Extract to shared libs (monorepo)
3. **Future**: Consider separate packages if open-sourcing

The key insight: **It's not about whether it's "wrong" - it's about whether it scales with your team and change frequency.**

For a small team maintaining 3 services, your current approach is **pragmatic and acceptable**. But as you grow, shared libraries will save significant time and reduce bugs.
