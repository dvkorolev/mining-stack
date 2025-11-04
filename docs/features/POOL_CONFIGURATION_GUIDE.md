# Pool Configuration Retrieval Guide

## Overview

The system now supports pool configuration retrieval from multiple miner types using various API methods.

## Supported Miner Types

### 1. Whatsminer (MicroBT)
**Models:** M20S, M21S, M30S, M30S+, M30S++, M31S, M50, M50S, M53, M56, etc.

**Default Credentials:**
- Username: `admin`
- Password: `admin`

**API Methods (tried in order):**

#### Method 1: CGMiner API v1 (Older Models)
```
GET http://{ip}/cgi-bin/luci/admin/network/cgminer
Auth: admin/admin
```
Returns pool data in `response.data.pools[]`

#### Method 2: Status Overview API (Newer Models like M30S++)
```
GET http://{ip}/cgi-bin/luci/admin/status/overview
Auth: admin/admin
```
Returns pool data in `response.data.pool.pool1`, `pool2`, `pool3`

#### Method 3: Direct Pool Endpoint
```
GET http://{ip}/cgi-bin/luci/admin/network/cgminer/pool
Auth: admin/admin
```
Returns pool data in `response.data.pools[]`

### 2. Antminer (Bitmain)
**Models:** S9, S17, S17+, S19, S19j, S19 Pro, S19j Pro, S19 XP, T17, T19, etc.

**Default Credentials:**
- Username: `root`
- Password: `root`

**API Methods (tried in order):**

#### Method 1: Get Miner Config CGI (Most Common)
```
GET http://{ip}/cgi-bin/get_miner_conf.cgi
Auth: root/root
```
Returns pool data in:
- `_ant_pool1url`, `_ant_pool1user`
- `_ant_pool2url`, `_ant_pool2user`
- `_ant_pool3url`, `_ant_pool3user`

Or alternative naming:
- `pool1url`, `pool1user`
- `pool2url`, `pool2user`
- `pool3url`, `pool3user`

#### Method 2: Pools CGI (Newer Firmware)
```
GET http://{ip}/cgi-bin/pools.cgi
Auth: root/root
```
Returns pool data in `response.data.pools[]`

### 3. AvalonMiner (Canaan)
**Models:** A1066, A1166, A1246, A1366, etc.

**Default Credentials:**
- Username: `root`
- Password: `root`

**API Method:**
```
GET http://{ip}/cgi-bin/luci/admin/avalon/pool
Auth: root/root
```
Returns pool data in `response.data.pools[]`

### 4. Innosilicon
**Models:** A10, A10 Pro, A11, A11 Pro, etc.

**Default Credentials:**
- Username: `admin`
- Password: `admin`

**API Method:**
Uses generic CGMiner API (see below)

### 5. Generic CGMiner API (Fallback)
**Works for:** Most miners with CGMiner-based firmware

**No Authentication Required**

**API Method:**
```
POST http://{ip}:4028
Body: { "command": "pools" }
```
Returns pool data in `response.data.POOLS[]` with fields:
- `URL` or `url`
- `User` or `user` or `Worker`

## Model Detection Logic

The system detects miner type by checking the model string:

```typescript
const model = miner.model?.toLowerCase() || '';

// Whatsminer detection
const isWhatsminer = model.includes('m3') ||  // M30S, M31S, etc.
                     model.includes('m5') ||  // M50, M53, M56
                     model.includes('m2') ||  // M20S, M21S
                     model.includes('whatsminer');

// Antminer detection
const isAntminer = model.includes('s19') ||   // S19, S19j, S19 Pro
                   model.includes('s17') ||   // S17, S17+
                   model.includes('s9') ||    // S9, S9i, S9j
                   model.includes('t19') ||   // T19
                   model.includes('t17') ||   // T17, T17+
                   model.includes('antminer');

// AvalonMiner detection
const isAvalonminer = model.includes('avalon') ||
                      model.includes('a1');    // A1066, A1166, etc.

// Innosilicon detection
const isInnosilicon = model.includes('a10') ||
                      model.includes('a11') ||
                      model.includes('innosilicon');
```

## Configuration in miners.yaml

### Example 1: Whatsminer M30S++ (Your Case)
```yaml
miners:
  - name: "EN-M30SppVH90-074"
    ip: "192.168.1.100"
    model: "Whatsminer M30S++"
    alias: "Miner 1"
    username: "admin"  # Optional, defaults to 'admin' for Whatsminer
    password: "admin"  # Optional, defaults to 'admin' for Whatsminer
```

### Example 2: Antminer S19j Pro
```yaml
miners:
  - name: "antminer-s19j-001"
    ip: "192.168.1.101"
    model: "Antminer S19j Pro"
    alias: "Miner 2"
    username: "root"   # Optional, defaults to 'root' for Antminer
    password: "root"   # Optional, defaults to 'root' for Antminer
```

### Example 3: AvalonMiner A1246
```yaml
miners:
  - name: "avalon-a1246-001"
    ip: "192.168.1.102"
    model: "AvalonMiner A1246"
    alias: "Miner 3"
    username: "root"
    password: "root"
```

## Troubleshooting

### Issue: "Pool Configuration Unavailable"

**Possible Causes:**

1. **Miner API is disabled**
   - Check miner web interface → Settings → API Access
   - Enable CGMiner API if available

2. **Wrong credentials**
   - Verify username/password in miners.yaml
   - Try accessing miner web interface with same credentials
   - Default credentials may have been changed

3. **Firewall blocking API**
   - Check if port 4028 (CGMiner API) is accessible
   - Check if HTTP port 80 is accessible
   - Test: `curl -u admin:admin http://{miner-ip}/cgi-bin/luci/admin/status/overview`

4. **Miner is offline or unreachable**
   - Ping the miner: `ping {miner-ip}`
   - Check network connectivity
   - Verify IP address is correct

5. **Non-standard firmware**
   - Some miners use custom firmware (Braiins OS, VNish, etc.)
   - These may have different API endpoints
   - Check firmware documentation

### Testing Pool Retrieval

#### Test via Telegram Bot
```
/pools EN-M30SppVH90-074
```

#### Test via API
```bash
curl http://localhost:5000/api/mining/miners/EN-M30SppVH90-074/pools
```

#### Test via Backend Logs
```bash
# On Raspberry Pi
docker compose -f docker-compose.prod.yml logs backend | grep -i pool
```

You should see debug logs like:
```
Detected miner type for EN-M30SppVH90-074: Whatsminer=true, Antminer=false
Pool retrieval method failed for EN-M30SppVH90-074: [error details]
Retrieved 3 pools for EN-M30SppVH90-074
```

### Manual Pool Check

#### For Whatsminer:
```bash
# Method 1
curl -u admin:admin http://{ip}/cgi-bin/luci/admin/network/cgminer

# Method 2
curl -u admin:admin http://{ip}/cgi-bin/luci/admin/status/overview

# Method 3
curl -u admin:admin http://{ip}/cgi-bin/luci/admin/network/cgminer/pool
```

#### For Antminer:
```bash
# Method 1
curl -u root:root http://{ip}/cgi-bin/get_miner_conf.cgi

# Method 2
curl -u root:root http://{ip}/cgi-bin/pools.cgi
```

#### For Any Miner (CGMiner API):
```bash
echo '{"command":"pools"}' | nc {ip} 4028
```

## Response Format

### Success Response
```json
{
  "success": true,
  "pools": [
    {
      "url": "stratum+tcp://pool.example.com:3333",
      "user": "your_wallet.worker1",
      "password": "***"
    },
    {
      "url": "stratum+tcp://backup.example.com:3333",
      "user": "your_wallet.worker1",
      "password": "***"
    }
  ]
}
```

### Error Response
```json
{
  "success": false,
  "message": "Unable to retrieve pool configuration. Please check:\n• Miner is online at 192.168.1.100\n• Credentials are correct (admin)\n• Miner API is accessible\n\nYou can view pools manually at: http://192.168.1.100"
}
```

## Security Notes

1. **Passwords are masked** - Pool passwords are never returned in API responses (shown as `***`)
2. **Authentication required** - All API endpoints require miner authentication
3. **Credentials in config** - Store credentials in `miners.yaml`, not in code
4. **HTTPS not supported** - Most miners only support HTTP (not HTTPS)

## Adding Support for New Miner Types

To add support for a new miner type:

1. **Add detection logic** in `getMinerPools()`:
```typescript
const isNewMinerType = model.includes('newtype');
```

2. **Set default credentials**:
```typescript
if (isNewMinerType) {
  defaultUsername = 'admin';
  defaultPassword = 'password';
}
```

3. **Add API method**:
```typescript
if (isNewMinerType) {
  methods.push(async () => {
    const response = await axios.get(`http://${miner.ip}/api/pools`, {
      timeout: 5000,
      auth: { username, password },
    });
    
    return response.data.pools.map((pool: any) => ({
      url: pool.url || '',
      user: pool.user || '',
      password: '***',
    }));
  });
}
```

## API Endpoint Summary

| Miner Type | Endpoint | Port | Auth | Method |
|------------|----------|------|------|--------|
| Whatsminer v1 | `/cgi-bin/luci/admin/network/cgminer` | 80 | admin/admin | GET |
| Whatsminer v2 | `/cgi-bin/luci/admin/status/overview` | 80 | admin/admin | GET |
| Whatsminer v3 | `/cgi-bin/luci/admin/network/cgminer/pool` | 80 | admin/admin | GET |
| Antminer v1 | `/cgi-bin/get_miner_conf.cgi` | 80 | root/root | GET |
| Antminer v2 | `/cgi-bin/pools.cgi` | 80 | root/root | GET |
| AvalonMiner | `/cgi-bin/luci/admin/avalon/pool` | 80 | root/root | GET |
| CGMiner API | `/` | 4028 | None | POST |

## Next Steps

After deploying the update:
1. Test pool retrieval with your Whatsminer M30S++
2. Check backend logs for detailed error messages
3. Verify credentials are correct
4. Ensure miner API is enabled
5. Report any issues with specific error messages
