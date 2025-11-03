# Mining Stack Architecture

## Design Principles

1. **Separation of Concerns** - Each service has a single, well-defined responsibility
2. **Microservices** - Services communicate via standard protocols (HTTP, metrics)
3. **Data Flow** - Unidirectional data flow from hardware → metrics → storage → API → UI
4. **Language-Specific Services** - Python for hardware, Node.js for web, Go for monitoring

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         HOST SYSTEM                              │
│  (Raspberry Pi - Direct Hardware Access)                         │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Python Scraper Service (Cron Job)                         │ │
│  │  ─────────────────────────────────────────────────────────  │ │
│  │  • bin/collect_all_metrics.sh (every 2 min)               │ │
│  │  • bin/farm_init.py (manual discovery)                     │ │
│  │  • Uses pyasic library for ASIC miner communication        │ │
│  │  • Writes metrics to /var/lib/node_exporter/textfile/      │ │
│  │  • Output: *.prom files (Prometheus format)                │ │
│  │                                                             │ │
│  │  Why Python?                                                │ │
│  │  - pyasic library for ASIC miners                          │ │
│  │  - Direct network/hardware access                          │ │
│  │  - Runs on host, not in container                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↓                                    │
│                    .prom files on disk                            │
└───────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                    DOCKER CONTAINERS                             │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Node Exporter (Go)                                        │ │
│  │  ─────────────────────────────────────────────────────────  │ │
│  │  • Reads .prom files from textfile collector               │ │
│  │  • Exposes metrics on :9100/metrics                        │ │
│  │  • Standard Prometheus exporter                            │ │
│  │                                                             │ │
│  │  Why Node Exporter?                                         │ │
│  │  - Industry standard for host metrics                      │ │
│  │  - Textfile collector for custom metrics                   │ │
│  │  - Efficient, battle-tested                                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↓                                    │
│                         HTTP scrape                               │
│                              ↓                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Prometheus (Go)                                           │ │
│  │  ─────────────────────────────────────────────────────────  │ │
│  │  • Scrapes Node Exporter every 15s                         │ │
│  │  • Stores time-series data                                 │ │
│  │  • Provides PromQL query API                               │ │
│  │  • Evaluates alerting rules                                │ │
│  │                                                             │ │
│  │  Why Prometheus?                                            │ │
│  │  - Purpose-built for metrics                               │ │
│  │  - Powerful query language (PromQL)                        │ │
│  │  - Built-in alerting                                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↓                                    │
│                         HTTP API                                  │
│                              ↓                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Backend (Node.js)                                         │ │
│  │  ─────────────────────────────────────────────────────────  │ │
│  │  • Queries Prometheus API                                  │ │
│  │  • Serves REST API to frontend                             │ │
│  │  • Manages miners.yaml configuration                       │ │
│  │  • Telegram bot integration                                │ │
│  │  • WebSocket for real-time updates                         │ │
│  │  • NO hardware scraping                                    │ │
│  │  • NO Python dependencies                                  │ │
│  │                                                             │ │
│  │  Why Node.js?                                               │ │
│  │  - Fast REST API development                               │ │
│  │  - Easy WebSocket support                                  │ │
│  │  - Good for I/O-bound operations                           │ │
│  │  - Separate from hardware layer                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↓                                    │
│                         HTTP/WebSocket                            │
│                              ↓                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Frontend (React + TypeScript)                             │ │
│  │  ─────────────────────────────────────────────────────────  │ │
│  │  • React UI with Material-UI                               │ │
│  │  • Real-time updates via WebSocket                         │ │
│  │  • Charts with Recharts                                    │ │
│  │  • Miner management interface                              │ │
│  │                                                             │ │
│  │  Why React?                                                 │ │
│  │  - Component-based architecture                            │ │
│  │  - Rich ecosystem                                           │ │
│  │  - TypeScript for type safety                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Alertmanager (Go)                                         │ │
│  │  ─────────────────────────────────────────────────────────  │ │
│  │  • Receives alerts from Prometheus                         │ │
│  │  • Routes to Telegram bot                                  │ │
│  │  • Deduplication and grouping                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Grafana (Go)                                              │ │
│  │  ─────────────────────────────────────────────────────────  │ │
│  │  • Advanced dashboards                                     │ │
│  │  • Queries Prometheus directly                             │ │
│  │  • Alternative to custom frontend                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Metrics Collection (Every 2 minutes)

```
1. Cron triggers: /opt/mining-stack/bin/collect_all_metrics.sh
2. Script runs Python collectors in parallel:
   - pyasic_textfile.py (ASIC miners via pyasic)
   - universal_miner_collector.py (generic miners via HTTP)
3. Collectors write to: /var/lib/node_exporter/textfile/*.prom
4. Node Exporter reads .prom files
5. Prometheus scrapes Node Exporter (every 15s)
6. Data stored in Prometheus time-series database
```

### User Query (Real-time)

```
1. User opens web UI (React frontend)
2. Frontend calls Backend API (Node.js)
3. Backend queries Prometheus API (PromQL)
4. Prometheus returns time-series data
5. Backend formats and returns to frontend
6. Frontend renders charts and stats
```

### Miner Discovery (Manual)

```
1. User SSHs to Raspberry Pi
2. Runs: /opt/mining-stack/bin/farm_init.py
3. Script scans network for miners (pyasic)
4. Writes discovered miners to: etc/miners.yaml
5. Backend auto-reloads miners.yaml
6. Frontend shows new miners
```

## Why This Architecture?

### Separation of Concerns

**Python Scraper (Host)**
- ✅ Direct hardware/network access
- ✅ Uses specialized libraries (pyasic)
- ✅ Runs as cron job
- ❌ NOT in Docker (needs host network)

**Node Exporter (Container)**
- ✅ Standard Prometheus exporter
- ✅ Textfile collector for custom metrics
- ✅ Efficient, minimal overhead

**Prometheus (Container)**
- ✅ Purpose-built time-series database
- ✅ Powerful query language
- ✅ Built-in alerting

**Backend (Container)**
- ✅ Web API and business logic
- ✅ Configuration management
- ✅ Telegram bot
- ❌ NO hardware scraping
- ❌ NO Python dependencies

**Frontend (Container)**
- ✅ User interface
- ✅ Real-time updates
- ✅ Charts and visualizations

### Benefits

1. **Clean Separation**
   - Each service does one thing well
   - Easy to understand and maintain
   - Clear boundaries

2. **Language-Appropriate**
   - Python for hardware (pyasic)
   - Node.js for web API
   - Go for monitoring tools
   - React for UI

3. **Scalability**
   - Services can scale independently
   - Python scraper on host (1 instance)
   - Backend can run multiple replicas

4. **Maintainability**
   - Single dependency manager per service
   - No mixed npm/pip in same container
   - Easier debugging

5. **Standard Protocols**
   - Prometheus metrics format
   - REST API
   - WebSocket
   - All industry standards

## Anti-Patterns to Avoid

### ❌ DON'T: Mix Python and Node.js in Backend

```dockerfile
# BAD - Violates separation of concerns
FROM node:18-alpine
RUN apk add python3 py3-pip
RUN pip3 install pyasic
```

**Why it's bad:**
- Bloated container image
- Mixed dependency management
- Backend shouldn't scrape hardware
- Violates single responsibility

### ❌ DON'T: Run Hardware Scraping in Container

```typescript
// BAD - Backend shouldn't scrape hardware
const discoverMiners = async () => {
  const { stdout } = await execAsync('python3 farm_init.py');
  // ...
};
```

**Why it's bad:**
- Container needs host network access
- Requires Python in Node.js container
- Backend's job is to query Prometheus, not hardware

### ✅ DO: Keep Services Separate

```
Host (Python) → Node Exporter → Prometheus → Backend (Node.js) → Frontend
```

**Why it's good:**
- Each service has one responsibility
- Language-appropriate tools
- Standard protocols
- Easy to maintain

## Service Responsibilities

### Python Scraper (Host)
- ✅ Collect metrics from miners
- ✅ Discover new miners
- ✅ Write .prom files
- ❌ NO web API
- ❌ NO UI

### Backend (Node.js)
- ✅ Query Prometheus
- ✅ Serve REST API
- ✅ Manage configuration
- ✅ Telegram bot
- ❌ NO hardware scraping
- ❌ NO Python

### Frontend (React)
- ✅ User interface
- ✅ Charts and visualizations
- ✅ Real-time updates
- ❌ NO direct Prometheus queries
- ❌ NO business logic

## Configuration Files

```
/opt/mining-stack/
├── etc/
│   └── miners.yaml          # Miner configuration (edited by farm_init.py)
├── bin/
│   ├── farm_init.py         # Discovery script (run on host)
│   ├── collect_all_metrics.sh  # Cron job (run on host)
│   ├── pyasic_textfile.py   # ASIC collector (run on host)
│   └── universal_miner_collector.py  # Generic collector (run on host)
├── docker-compose.prod.yml  # Container orchestration
└── .env                     # Environment variables
```

## Deployment

### Initial Setup
```bash
# On Raspberry Pi
cd /opt/mining-stack
./bin/setup-pyasic-venv.sh    # Setup Python environment on host
./bin/setup-metrics-cron.sh   # Setup cron job for metrics
docker compose -f docker-compose.prod.yml up -d  # Start containers
```

### Discover Miners
```bash
# On Raspberry Pi (not in container!)
/opt/mining-stack/bin/farm_init.py
```

### Update Application
```bash
# On Raspberry Pi
cd /opt/mining-stack
git pull origin main
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

## Summary

**Key Principle:** Each service uses the right tool for its job.

- **Python** for hardware scraping (pyasic)
- **Node.js** for web API (Express)
- **Go** for monitoring (Prometheus, Node Exporter)
- **React** for UI (TypeScript)

**Data flows one direction:** Hardware → Metrics → Storage → API → UI

**No mixing:** Each container has one language, one purpose, one responsibility.
