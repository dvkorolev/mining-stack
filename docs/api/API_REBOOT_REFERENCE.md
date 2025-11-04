# Reboot API Reference

## Overview

The Mining Stack provides comprehensive miner reboot functionality through REST API endpoints. This document details all available reboot options, their implementation, and usage examples.

## Table of Contents

1. [API Endpoints](#api-endpoints)
2. [Reboot Implementation](#reboot-implementation)
3. [Configuration](#configuration)
4. [Usage Examples](#usage-examples)
5. [Error Handling](#error-handling)
6. [Testing](#testing)

---

## API Endpoints

### 1. Single Miner Reboot

**Endpoint:** `POST /api/mining/miners/:minerId/reboot`

**Description:** Reboot a single miner by its ID.

**Parameters:**
- `minerId` (path): Miner identifier (name or IP)

**Request:**
```bash
curl -X POST http://localhost:5000/api/mining/miners/miner-192-168-1-40/reboot
```

**Response:**
```json
{
  "success": true,
  "message": "Reboot command sent to EN-M30SppVH90-040"
}
```

**Status Codes:**
- `200` - Success
- `404` - Miner not found
- `500` - Internal error

---

### 2. Bulk Reboot (Selected Miners)

**Endpoint:** `POST /api/mining/miners/bulk/reboot`

**Description:** Reboot multiple selected miners in parallel.

**Request Body:**
```json
{
  "minerIds": [
    "miner-192-168-1-40",
    "miner-192-168-1-52",
    "miner-192-168-1-64"
  ]
}
```

**Request:**
```bash
curl -X POST http://localhost:5000/api/mining/miners/bulk/reboot \
  -H "Content-Type: application/json" \
  -d '{
    "minerIds": ["miner-192-168-1-40", "miner-192-168-1-52"]
  }'
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "minerId": "miner-192-168-1-40",
      "success": true,
      "message": "Reboot command sent to EN-M30SppVH90-040"
    },
    {
      "minerId": "miner-192-168-1-52",
      "success": true,
      "message": "Reboot command sent to EN-M30SppVH40-052"
    }
  ]
}
```

**Status Codes:**
- `200` - Success (check individual results)
- `400` - Invalid request (missing minerIds array)
- `500` - Internal error

---

### 3. Reboot All Miners

**Endpoint:** `POST /api/mining/miners/reboot-all`

**Description:** Reboot all configured miners in the farm.

**Request:**
```bash
curl -X POST http://localhost:5000/api/mining/miners/reboot-all
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "minerId": "miner-192-168-1-40",
      "success": true,
      "message": "Reboot command sent to EN-M30SppVH90-040"
    },
    {
      "minerId": "miner-192-168-1-52",
      "success": true,
      "message": "Reboot command sent to EN-M30SppVH40-052"
    }
    // ... all 22 miners
  ]
}
```

**Status Codes:**
- `200` - Success (check individual results)
- `500` - Internal error

---

## Reboot Implementation

### Miner Type Detection

The system automatically detects miner type from the model string:

```typescript
const model = miner.model?.toLowerCase() || '';
const isWhatsminer = model.includes('m30') || model.includes('m50') || model.includes('m20');
const isAntminer = model.includes('s19') || model.includes('s17') || model.includes('t19');
```

### Reboot Endpoints by Miner Type

#### Whatsminer (M30S++, M50, M50S++)

**Primary Method:**
```
GET http://192.168.1.40/cgi-bin/luci/admin/network/iface_reconnect/lan
```

**Authentication:**
- Default: `admin` / `admin`
- Configurable via `miners.yaml`

**Protocol:**
- HTTP (default)
- HTTPS (if `useHttps: true`)

**Example:**
```bash
curl -X GET http://192.168.1.40/cgi-bin/luci/admin/network/iface_reconnect/lan \
  -u admin:admin
```

#### Antminer (S19, S19 Pro, S19K Pro)

**Primary Method:**
```
GET http://192.168.1.64/cgi-bin/reboot.cgi
```

**Authentication:**
- Default: `root` / `root`
- Configurable via `miners.yaml`

**Protocol:**
- HTTP (default)
- HTTPS (if `useHttps: true`)

**Example:**
```bash
curl -X GET http://192.168.1.64/cgi-bin/reboot.cgi \
  -u root:root
```

#### Generic Fallback

If miner-specific endpoints fail, the system tries:

1. `POST http://{ip}/api/reboot`
2. `POST http://{ip}/reboot`

### Endpoint Fallback Sequence

```typescript
const endpoints = [
  // Miner-specific (tried first)
  { url: 'http://192.168.1.40/cgi-bin/luci/admin/network/iface_reconnect/lan', method: 'get' },
  
  // Generic fallbacks
  { url: 'http://192.168.1.40/api/reboot', method: 'post' },
  { url: 'http://192.168.1.40/reboot', method: 'post' }
];
```

The system tries each endpoint sequentially until one succeeds.

### HTTPS Support

**Configuration:**
```yaml
# miners.yaml
miners:
  - ip: 192.168.1.40
    name: miner-192-168-1-40
    model: M30S++ VH90
    useHttps: true  # Enable HTTPS
    credentials:
      username: admin
      password: admin
```

**Implementation:**
- Accepts self-signed certificates
- Uses `rejectUnauthorized: false`
- Automatic protocol selection

**Example:**
```bash
curl -X GET https://192.168.1.40/cgi-bin/luci/admin/network/iface_reconnect/lan \
  -u admin:admin \
  -k  # Accept self-signed certificate
```

---

## Configuration

### miners.yaml Structure

```yaml
miners:
  - ip: 192.168.1.40
    name: miner-192-168-1-40
    alias: EN-M30SppVH90-040
    model: M30S++ VH90
    owner: Farm-A
    
    # Optional: Custom credentials
    credentials:
      username: admin
      password: custom_password
    
    # Optional: Use HTTPS
    useHttps: false
    
    # Optional: Per-miner thresholds
    thresholds:
      temperature:
        warning: 80
        critical: 90
        shutdown: 95
```

### Default Credentials

**Whatsminer:**
- Username: `admin`
- Password: `admin`

**Antminer:**
- Username: `root`
- Password: `root`

**Override:**
```yaml
credentials:
  username: custom_user
  password: custom_pass
```

---

## Usage Examples

### Frontend (React)

```typescript
// Single miner reboot
const handleReboot = async (minerId: string) => {
  try {
    const response = await fetch(`/api/mining/miners/${minerId}/reboot`, {
      method: 'POST'
    });
    const result = await response.json();
    
    if (result.success) {
      alert(`✓ ${result.message}`);
    } else {
      alert(`✗ ${result.message}`);
    }
  } catch (error) {
    alert('Error rebooting miner');
  }
};

// Bulk reboot
const handleBulkReboot = async (minerIds: string[]) => {
  const response = await fetch('/api/mining/miners/bulk/reboot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minerIds })
  });
  const result = await response.json();
  
  const successCount = result.results.filter(r => r.success).length;
  alert(`Rebooted ${successCount} of ${minerIds.length} miners`);
};

// Reboot all
const handleRebootAll = async () => {
  if (!confirm('⚠️ Reboot ALL miners?')) return;
  
  const response = await fetch('/api/mining/miners/reboot-all', {
    method: 'POST'
  });
  const result = await response.json();
  
  const successCount = result.results.filter(r => r.success).length;
  alert(`Rebooted ${successCount} miners`);
};
```

### CLI (curl)

```bash
# Single miner
curl -X POST http://localhost:5000/api/mining/miners/miner-192-168-1-40/reboot

# Bulk reboot
curl -X POST http://localhost:5000/api/mining/miners/bulk/reboot \
  -H "Content-Type: application/json" \
  -d '{"minerIds": ["miner-192-168-1-40", "miner-192-168-1-52"]}'

# Reboot all
curl -X POST http://localhost:5000/api/mining/miners/reboot-all

# With jq for pretty output
curl -s -X POST http://localhost:5000/api/mining/miners/reboot-all | jq .
```

### Python

```python
import requests

# Single miner
def reboot_miner(miner_id):
    response = requests.post(
        f'http://localhost:5000/api/mining/miners/{miner_id}/reboot'
    )
    return response.json()

# Bulk reboot
def reboot_miners(miner_ids):
    response = requests.post(
        'http://localhost:5000/api/mining/miners/bulk/reboot',
        json={'minerIds': miner_ids}
    )
    return response.json()

# Reboot all
def reboot_all():
    response = requests.post(
        'http://localhost:5000/api/mining/miners/reboot-all'
    )
    return response.json()

# Usage
result = reboot_miner('miner-192-168-1-40')
print(f"Success: {result['success']}, Message: {result['message']}")
```

### Telegram Bot

```
/reboot miner-192-168-1-40
```

The bot will:
1. Ask for confirmation
2. Execute reboot via API
3. Report success/failure

---

## Error Handling

### Common Errors

**1. Miner Not Found**
```json
{
  "success": false,
  "message": "Miner miner-192-168-1-999 not found"
}
```

**Solution:** Check miner ID in `/opt/mining-stack/etc/miners.yaml`

**2. No Compatible API Found**
```json
{
  "success": false,
  "message": "Failed to reboot EN-M30SppVH90-040 - no compatible API found. Try rebooting manually via miner web interface at http://192.168.1.40"
}
```

**Possible causes:**
- Miner is offline
- Wrong credentials
- Firewall blocking
- Miner doesn't support reboot API

**Solution:**
1. Check miner is online: `ping 192.168.1.40`
2. Verify credentials in `miners.yaml`
3. Try manual reboot via web interface
4. Check miner logs

**3. Timeout**
```json
{
  "success": false,
  "message": "Error rebooting miner: timeout of 5000ms exceeded"
}
```

**Solution:**
- Check network connectivity
- Verify miner IP address
- Increase timeout (requires code change)

**4. Authentication Failed**
```json
{
  "success": false,
  "message": "Error rebooting miner: Request failed with status code 401"
}
```

**Solution:**
- Update credentials in `miners.yaml`
- Check default credentials for miner type

### Retry Logic

The system automatically retries with fallback endpoints:
1. Try miner-specific endpoint
2. Try generic `/api/reboot`
3. Try generic `/reboot`
4. Return failure if all attempts fail

### Logging

All reboot attempts are logged:

```
[INFO] Rebooting miner: EN-M30SppVH90-040 (192.168.1.40)
[DEBUG] Trying Whatsminer reboot for EN-M30SppVH90-040 with credentials from config
[INFO] Miner EN-M30SppVH90-040 reboot command sent successfully via Whatsminer reboot
```

Check logs:
```bash
docker logs backend
```

---

## Testing

### Automated Test Script

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack
chmod +x test/verify-reboot-api.sh
./test/verify-reboot-api.sh
```

The script tests:
- ✓ Single miner reboot
- ✓ Bulk reboot
- ✓ Reboot all miners
- ✓ Error handling (invalid miner ID)
- ✓ Invalid payload handling

### Manual Testing

**1. Test single miner:**
```bash
curl -X POST http://localhost:5000/api/mining/miners/miner-192-168-1-40/reboot
```

**2. Check response:**
```json
{"success": true, "message": "Reboot command sent to EN-M30SppVH90-040"}
```

**3. Verify miner reboots:**
- Check miner web interface
- Monitor uptime metric: `miner_uptime_seconds`
- Check Grafana dashboard

**4. Check logs:**
```bash
docker logs backend | grep -i reboot
```

### Integration Testing

**Test via Frontend:**
1. Open http://localhost:3000/miners
2. Select a miner
3. Click "Reboot" button
4. Confirm action
5. Verify success message

**Test via Telegram:**
1. Send `/reboot miner-192-168-1-40`
2. Confirm reboot
3. Check response

---

## Summary

### Available Reboot Options

| Method | Endpoint | Use Case |
|--------|----------|----------|
| Single | `POST /api/mining/miners/:minerId/reboot` | Reboot one miner |
| Bulk | `POST /api/mining/miners/bulk/reboot` | Reboot selected miners |
| All | `POST /api/mining/miners/reboot-all` | Reboot entire farm |

### Supported Miners

| Type | Model | Method | Default Credentials |
|------|-------|--------|---------------------|
| Whatsminer | M30S++, M50, M50S++ | HTTP/HTTPS GET | admin/admin |
| Antminer | S19, S19 Pro, S19K Pro | HTTP/HTTPS GET | root/root |
| Generic | Any cgminer | POST | Configurable |

### Key Features

✅ **Automatic miner type detection**
✅ **Configurable credentials**
✅ **HTTPS support with self-signed certificates**
✅ **Multiple endpoint fallback**
✅ **Parallel bulk operations**
✅ **Comprehensive error handling**
✅ **Detailed logging**
✅ **Frontend integration**
✅ **Telegram bot support**

### Configuration Files

- **Miners:** `/opt/mining-stack/etc/miners.yaml`
- **Backend:** `/opt/mining-stack/backend/src/services/miner-control.service.ts`
- **Routes:** `/opt/mining-stack/backend/src/routes/mining.routes.ts`
- **Frontend:** `/opt/mining-stack/frontend/src/pages/Miners.tsx`

---

## Quick Reference

```bash
# Single miner
curl -X POST http://localhost:5000/api/mining/miners/{minerId}/reboot

# Bulk reboot
curl -X POST http://localhost:5000/api/mining/miners/bulk/reboot \
  -H "Content-Type: application/json" \
  -d '{"minerIds": ["miner1", "miner2"]}'

# Reboot all
curl -X POST http://localhost:5000/api/mining/miners/reboot-all

# Check logs
docker logs backend | grep -i reboot

# Test script
./test/verify-reboot-api.sh
```

**All reboot functionality is fully implemented and tested!** ✅
