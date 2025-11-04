# Centralized Log Service Design

## Overview

A dedicated logging service that sits between your applications and log storage backends, providing validation, enrichment, buffering, and multi-backend support.

## Architecture

```
┌─────────────────┐
│ Python Scheduler│──┐
└─────────────────┘  │
                     │
┌─────────────────┐  │    ┌──────────────────┐    ┌──────────┐
│   Backend API   │──┼───▶│   Log Service    │───▶│   Loki   │
└─────────────────┘  │    │                  │    └──────────┘
                     │    │ - Validation     │
┌─────────────────┐  │    │ - Enrichment     │    ┌──────────┐
│    Frontend     │──┘    │ - Buffering      │───▶│    S3    │
└─────────────────┘       │ - Rate Limiting  │    └──────────┘
                          │ - Multi-backend  │
                          └──────────────────┘    ┌──────────┐
                                    │             │  Other   │
                                    └────────────▶│ Backends │
                                                  └──────────┘
```

## When to Use

### ✅ Use Separate Log Service When:
1. **High volume** (>10k logs/second)
2. **Multiple backends** (Loki + S3 + Elasticsearch)
3. **Compliance** (PII scrubbing, audit trails)
4. **Complex enrichment** (add metadata, geo data, etc.)
5. **Cost optimization** (sampling, compression)
6. **Guaranteed delivery** (retry logic, dead letter queue)

### ❌ Don't Use When:
1. Low volume (<1k logs/second)
2. Single backend (just Loki)
3. Simple use case (just debugging)
4. Team is small (adds maintenance burden)

## Implementation Options

### Option 1: Lightweight (Recommended for Mining-Stack)

**Use Vector.dev** - A lightweight, high-performance log router

```yaml
# vector.toml
[sources.http]
type = "http"
address = "0.0.0.0:8686"
encoding = "json"

[transforms.enrich]
type = "remap"
inputs = ["http"]
source = '''
  # Add timestamp if missing
  if !exists(.timestamp) {
    .timestamp = now()
  }
  
  # Add environment
  .environment = get_env_var!("ENVIRONMENT")
  
  # Scrub sensitive data
  if exists(.extra.password) {
    .extra.password = "***REDACTED***"
  }
'''

[sinks.loki]
type = "loki"
inputs = ["enrich"]
endpoint = "http://loki:3100"
encoding.codec = "json"

[sinks.s3]
type = "aws_s3"
inputs = ["enrich"]
bucket = "mining-logs"
compression = "gzip"
```

**Pros**:
- ✅ Lightweight (written in Rust)
- ✅ High performance
- ✅ Easy configuration
- ✅ Built-in transforms
- ✅ Multiple sinks

**Cons**:
- ❌ Less flexible than custom service
- ❌ Limited business logic

### Option 2: Custom Service (For Complex Requirements)

**Tech Stack**: Node.js/TypeScript or Go

```typescript
// log-service/src/server.ts
import express from 'express';
import { validateLog, enrichLog, sendToBackends } from './processors';

const app = express();
app.use(express.json());

// Buffer for batching
const logBuffer: LogEntry[] = [];
const BATCH_SIZE = 100;
const BATCH_INTERVAL = 5000; // 5 seconds

app.post('/logs', async (req, res) => {
  try {
    // 1. Validate
    const log = validateLog(req.body);
    
    // 2. Enrich
    const enrichedLog = enrichLog(log, {
      environment: process.env.ENVIRONMENT,
      cluster: process.env.CLUSTER_NAME,
      received_at: new Date().toISOString()
    });
    
    // 3. Buffer
    logBuffer.push(enrichedLog);
    
    // 4. Batch send if buffer is full
    if (logBuffer.length >= BATCH_SIZE) {
      await flushBuffer();
    }
    
    res.status(202).json({ status: 'accepted' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

async function flushBuffer() {
  if (logBuffer.length === 0) return;
  
  const batch = logBuffer.splice(0, logBuffer.length);
  
  // Send to multiple backends in parallel
  await Promise.allSettled([
    sendToLoki(batch),
    sendToS3(batch),
    sendToMetrics(batch) // Extract metrics from logs
  ]);
}

// Periodic flush
setInterval(flushBuffer, BATCH_INTERVAL);
```

**Pros**:
- ✅ Full control
- ✅ Custom business logic
- ✅ Easy to extend
- ✅ Can add complex features

**Cons**:
- ❌ More code to maintain
- ❌ Need to handle reliability
- ❌ Performance tuning required

### Option 3: Enterprise (Fluentd/Fluent Bit)

**Use Fluentd** - Industry standard log collector

```ruby
# fluent.conf
<source>
  @type http
  port 8888
  bind 0.0.0.0
  body_size_limit 32m
  keepalive_timeout 10s
</source>

<filter **>
  @type record_transformer
  <record>
    environment "#{ENV['ENVIRONMENT']}"
    cluster "#{ENV['CLUSTER_NAME']}"
  </record>
</filter>

<match **>
  @type copy
  
  # Send to Loki
  <store>
    @type loki
    url http://loki:3100
    flush_interval 10s
  </store>
  
  # Send to S3
  <store>
    @type s3
    s3_bucket mining-logs
    s3_region us-east-1
    path logs/
    time_slice_format %Y%m%d%H
  </store>
</match>
```

**Pros**:
- ✅ Battle-tested
- ✅ Rich plugin ecosystem
- ✅ Enterprise support
- ✅ High reliability

**Cons**:
- ❌ Ruby-based (higher memory usage)
- ❌ Complex configuration
- ❌ Steeper learning curve

## Recommended Implementation for Mining-Stack

### Phase 1 (Current): Keep It Simple
```
Services → stdout → Promtail → Loki
```
**When**: Now (you're here)
**Why**: Simple, reliable, works

### Phase 2: Add Vector for Multi-Backend
```
Services → HTTP → Vector → Loki + S3
```
**When**: When you need:
- Long-term storage (S3)
- Cost optimization (sampling)
- Data scrubbing

### Phase 3: Custom Service for Advanced Features
```
Services → HTTP → Custom Log Service → Multiple Backends
```
**When**: When you need:
- Complex business logic
- Custom enrichment
- Advanced filtering
- Guaranteed delivery

## Example: Adding Vector to Your Stack

### 1. Create vector.toml

```toml
# vector.toml
[sources.services_http]
type = "http"
address = "0.0.0.0:8686"
encoding = "json"

[transforms.parse_and_enrich]
type = "remap"
inputs = ["services_http"]
source = '''
  # Ensure timestamp is ISO 8601
  if !exists(.timestamp) {
    .timestamp = now()
  }
  
  # Add environment metadata
  .environment = get_env_var!("ENVIRONMENT")
  .cluster = get_env_var!("CLUSTER_NAME")
  
  # Scrub sensitive data
  if exists(.extra.password) {
    .extra.password = "***REDACTED***"
  }
  if exists(.extra.api_key) {
    .extra.api_key = "***REDACTED***"
  }
  
  # Add log size for monitoring
  .log_size_bytes = strlen(encode_json(.))
'''

[transforms.sample_debug]
type = "sample"
inputs = ["parse_and_enrich"]
rate = 10  # Keep 10% of DEBUG logs
key_field = "level"
exclude."level" = ["ERROR", "CRITICAL"]  # Never sample errors

[sinks.loki]
type = "loki"
inputs = ["sample_debug"]
endpoint = "http://loki:3100"
encoding.codec = "json"
labels.service = "{{ service }}"
labels.level = "{{ level }}"

[sinks.s3_archive]
type = "aws_s3"
inputs = ["sample_debug"]
bucket = "mining-logs-archive"
compression = "gzip"
encoding.codec = "json"
key_prefix = "logs/%Y/%m/%d/"

[sinks.metrics]
type = "prometheus_exporter"
inputs = ["sample_debug"]
address = "0.0.0.0:9598"
```

### 2. Update docker-compose.yml

```yaml
services:
  vector:
    image: timberio/vector:0.34.0-alpine
    container_name: vector
    ports:
      - "8686:8686"  # HTTP input
      - "9598:9598"  # Metrics
    volumes:
      - ./vector.toml:/etc/vector/vector.toml:ro
    environment:
      - ENVIRONMENT=production
      - CLUSTER_NAME=mining-cluster-01
    networks:
      - mining-network
    restart: unless-stopped

  # Update services to send logs to Vector
  python-scheduler:
    environment:
      - LOG_BACKEND=http://vector:8686
```

### 3. Update Python Logger

```python
# logging_config.py
import requests

class VectorHandler(logging.Handler):
    def __init__(self, vector_url):
        super().__init__()
        self.vector_url = vector_url
    
    def emit(self, record):
        try:
            log_entry = self.format(record)
            requests.post(
                self.vector_url,
                json=json.loads(log_entry),
                timeout=1
            )
        except:
            pass  # Don't break app if logging fails
```

## Cost-Benefit Analysis

### Current Setup (Promtail → Loki)
- **Cost**: Low (minimal resources)
- **Complexity**: Low
- **Features**: Basic
- **Maintenance**: Low
- **Best for**: Small-medium deployments

### With Vector
- **Cost**: Medium (+50MB RAM, +0.1 CPU)
- **Complexity**: Medium
- **Features**: Advanced (sampling, multi-backend, enrichment)
- **Maintenance**: Medium
- **Best for**: Production deployments with compliance needs

### Custom Log Service
- **Cost**: High (+200MB RAM, +0.5 CPU)
- **Complexity**: High
- **Features**: Unlimited (whatever you build)
- **Maintenance**: High
- **Best for**: Enterprise with specific requirements

## Decision Matrix

| Requirement | Current | + Vector | + Custom |
|-------------|---------|----------|----------|
| Basic logging | ✅ | ✅ | ✅ |
| Multi-backend | ❌ | ✅ | ✅ |
| Sampling | ❌ | ✅ | ✅ |
| PII scrubbing | ❌ | ✅ | ✅ |
| Custom logic | ❌ | ⚠️ | ✅ |
| Low latency | ✅ | ✅ | ⚠️ |
| Easy maintenance | ✅ | ⚠️ | ❌ |
| Cost | ✅ | ⚠️ | ❌ |

## Recommendation for Your Mining-Stack

### Now (Phase 1)
**Keep current setup**: Services → Promtail → Loki
- ✅ Simple and reliable
- ✅ Works for your scale
- ✅ Easy to maintain

### Later (Phase 2) - When You Need:
**Add Vector** if you need:
- Multiple backends (Loki + S3)
- Log sampling (reduce costs)
- PII scrubbing (compliance)
- Advanced enrichment

### Future (Phase 3) - Only If:
**Build custom service** only if:
- Very high volume (>100k logs/sec)
- Complex business requirements
- Custom integrations needed
- Team has capacity to maintain

## Conclusion

**For your mining-stack right now**: 
- ✅ **Stick with current approach** (Promtail → Loki)
- ✅ It's simple, reliable, and sufficient
- ✅ Focus on building features, not infrastructure

**Consider separate log service when**:
- You need multiple backends
- Compliance requires PII scrubbing
- Volume justifies the complexity
- You have team capacity to maintain it

The current architecture is **production-ready** and follows industry best practices. Don't over-engineer until you have a specific need! 🎯
