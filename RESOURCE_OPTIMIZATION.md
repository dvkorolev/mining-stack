# Resource Optimization for Raspberry Pi

## Current Setup Analysis

### Memory Usage on 4GB Raspberry Pi

```
Component          Memory    CPU    Storage    Purpose
─────────────────────────────────────────────────────────────
Frontend           ~100 MB   <5%    ~50 MB     Web UI
Backend            ~150 MB   <5%    ~100 MB    API + Logic
SQLite             ~20 MB    <1%    ~10 MB     Analytics DB
Prometheus         ~400 MB   ~5%    ~1-2 GB    Metrics
Node-exporter      ~50 MB    <2%    -          System metrics
Grafana            ~300 MB   <5%    ~100 MB    Dashboards
─────────────────────────────────────────────────────────────
TOTAL              ~1 GB     ~20%   ~1.3 GB    
Available          3 GB      80%    Plenty     
```

## ✅ Verdict: Your Setup is Fine!

With 4GB RAM, you have:
- **Used**: ~1 GB (25%)
- **Available**: ~3 GB (75%)
- **Comfortable headroom** for OS, buffers, and spikes

## SQLite vs Prometheus: Different Purposes

### SQLite (Analytics Database)
**Purpose**: Long-term historical data storage
- Custom queries and exports
- CSV downloads
- Trend analysis over weeks/months
- Lightweight (~20 MB RAM)
- Perfect for custom analytics

### Prometheus (Monitoring System)
**Purpose**: Real-time metrics and alerting
- Grafana integration
- Pre-built dashboards
- Alerting rules
- System-level metrics (CPU, disk, network)
- More memory (~400 MB) but powerful

### They Complement Each Other!

```
┌─────────────────────────────────────────┐
│         Your Mining Dashboard           │
│  (React UI + Custom Analytics)          │
│         Uses: SQLite                    │
└────────────┬────────────────────────────┘
             │
             │
┌────────────▼────────────────────────────┐
│         Grafana Dashboards              │
│  (Pre-built monitoring views)           │
│         Uses: Prometheus                │
└─────────────────────────────────────────┘
```

## Optimization Options

### Option 1: Keep Both (Recommended) ⭐

**Best for:**
- Users who want both custom analytics AND Grafana
- 4GB RAM is sufficient
- No performance issues

**Configuration:**
```yaml
# docker-compose.prod.yml
prometheus:
  deploy:
    resources:
      limits:
        cpus: '0.5'
        memory: 512M  # Already optimized

grafana:
  deploy:
    resources:
      limits:
        cpus: '0.5'
        memory: 512M  # Already optimized
```

**Benefits:**
- ✅ Custom analytics via SQLite
- ✅ Grafana dashboards for monitoring
- ✅ Alerting capabilities
- ✅ System metrics (CPU, disk, network)

### Option 2: SQLite Only (Minimal)

**Best for:**
- Users who only need custom analytics
- Want to minimize resource usage
- Don't need Grafana

**How to disable Prometheus/Grafana:**

```yaml
# docker-compose.prod.yml
# Comment out or remove these services:

# prometheus:
#   ...

# node-exporter:
#   ...

# grafana:
#   ...
```

**Savings:**
- Memory: ~750 MB freed
- Storage: ~1-2 GB freed
- CPU: ~10% freed

**Trade-offs:**
- ❌ No Grafana dashboards
- ❌ No pre-built monitoring views
- ❌ No system-level metrics
- ✅ Still have all analytics via SQLite
- ✅ Still have custom dashboard

### Option 3: Prometheus Only (No SQLite)

**Best for:**
- Users who only use Grafana
- Don't need custom analytics or CSV exports

**How to disable SQLite:**

Remove from `backend/src/services/mining.service.ts`:
```typescript
// Comment out database integration
// import { getDatabase } from './database.service';
// const db = getDatabase();
// db.insertStats(dbRecord);
```

**Savings:**
- Memory: ~20 MB freed (minimal)
- Storage: ~10 MB freed
- Complexity: Simpler codebase

**Trade-offs:**
- ❌ No historical data beyond Prometheus retention
- ❌ No CSV exports
- ❌ No custom SQL queries
- ✅ Still have Grafana dashboards
- ✅ Prometheus alerting

## Recommended Configuration for 4GB Pi

### Keep Both with Optimized Settings

**Prometheus Retention** (reduce storage):
```yaml
# docker/prometheus/prometheus.yml
global:
  scrape_interval: 30s  # Already optimized
  
# Add storage retention
storage:
  tsdb:
    retention.time: 15d  # Keep 15 days instead of default 15d
    retention.size: 1GB  # Limit to 1GB
```

**SQLite Retention** (already optimized):
- Raw data: 24 hours
- Hourly: 30 days
- Daily: Unlimited

**Result:**
- Prometheus: ~15 days of detailed metrics
- SQLite: Unlimited daily aggregates
- Total storage: ~1.5 GB
- Memory: ~1 GB

## Performance Monitoring

### Check Current Usage

```bash
# SSH to Raspberry Pi
ssh admin@raspberrypi

# Check memory
free -h

# Check Docker container usage
docker stats

# Check disk usage
df -h /opt/mining-stack/

# Check database size
ls -lh /opt/mining-stack/data/mining-stats.db
```

### Expected Output

```
CONTAINER       CPU %   MEM USAGE / LIMIT   MEM %
frontend        0.5%    80MB / 512MB        15%
backend         1.2%    120MB / 512MB       23%
prometheus      3.5%    350MB / 512MB       68%
grafana         2.1%    280MB / 512MB       54%
node-exporter   0.3%    40MB / 128MB        31%
```

## When to Optimize Further

### Signs You Need to Reduce Resources:

1. **High Memory Usage**
   ```bash
   free -h
   # If "available" < 500 MB, consider optimization
   ```

2. **Swap Usage**
   ```bash
   swapon --show
   # If swap is being used heavily, reduce services
   ```

3. **Slow Performance**
   - Dashboard takes >5 seconds to load
   - API responses >1 second
   - System feels sluggish

### Quick Wins to Free Memory

**1. Disable Grafana** (if not using):
```yaml
# docker-compose.prod.yml
# Comment out grafana service
# Saves: ~300 MB
```

**2. Reduce Prometheus Retention**:
```yaml
# Reduce to 7 days
retention.time: 7d
# Saves: ~500 MB storage
```

**3. Disable Node-exporter** (if not monitoring system):
```yaml
# Comment out node-exporter
# Saves: ~50 MB
```

## Comparison with Alternatives

### InfluxDB (Time-Series DB)
- Memory: ~500 MB (heavier than SQLite)
- Better for high-frequency writes
- Overkill for your use case

### PostgreSQL + TimescaleDB
- Memory: ~300 MB (heavier than SQLite)
- Better for complex queries
- Overkill for your use case

### SQLite (Current Choice)
- Memory: ~20 MB ✅
- Perfect for Raspberry Pi
- Sufficient for your needs

## Recommendations by Use Case

### Use Case 1: "I want everything"
**Keep:** SQLite + Prometheus + Grafana
**RAM:** 4GB is fine
**Storage:** 2GB needed

### Use Case 2: "I only use the custom dashboard"
**Keep:** SQLite only
**Disable:** Prometheus, Grafana, Node-exporter
**RAM:** 2GB is enough
**Storage:** 500MB needed

### Use Case 3: "I only use Grafana"
**Keep:** Prometheus + Grafana
**Disable:** SQLite (remove from code)
**RAM:** 4GB recommended
**Storage:** 1.5GB needed

### Use Case 4: "Minimal setup"
**Keep:** SQLite only
**Disable:** Everything else
**RAM:** 1GB is enough
**Storage:** 200MB needed

## My Recommendation

**For your 4GB Raspberry Pi: Keep both!**

Reasons:
1. ✅ You have plenty of RAM (3GB free)
2. ✅ SQLite is extremely lightweight
3. ✅ Prometheus/Grafana adds value
4. ✅ No performance issues expected
5. ✅ Best of both worlds

**Only optimize if:**
- You experience performance issues
- You never use Grafana
- You want to simplify maintenance

## Testing Your Setup

After deployment, monitor for 24 hours:

```bash
# Check memory every hour
watch -n 3600 free -h

# Check Docker stats
docker stats --no-stream

# Check if swap is being used
swapon --show

# Check database growth
watch -n 3600 ls -lh /opt/mining-stack/data/
```

**If all metrics look good → you're fine!**

## Conclusion

Your current setup with **SQLite + Prometheus on 4GB Pi is optimal**:

- ✅ Lightweight and efficient
- ✅ Complementary purposes
- ✅ Plenty of headroom
- ✅ No overlap or waste
- ✅ Best user experience

**No changes needed unless you have specific constraints!**
