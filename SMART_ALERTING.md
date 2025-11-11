# Smart Alert Routing

## Overview

The system now features intelligent alert routing that sends notifications to the right people based on alert type and miner ownership.

## Alert Types

### 1. Miner-Specific Alerts
**Sent to**: Miner owner only

These alerts are about individual miners and only notify the owner of that specific miner.

**Examples:**
- 🚨 **High Temperature**: "Miner temperature above 95°C"
- ⚠️ **Low Hashrate**: "Miner hashrate dropped below threshold"
- 🔴 **Miner Offline**: "Miner stopped responding"
- ⚠️ **High Rejection Rate**: "Pool rejection rate above 5%"
- 🚨 **Hardware Error**: "Miner reporting hardware faults"

**Routing Logic:**
1. Alert contains miner IP address
2. System looks up miner owner in database
3. Alert sent only to that owner's Telegram

### 2. Farm-Wide Alerts
**Sent to**: All authorized users

These alerts affect the entire farm or don't belong to a specific miner.

**Examples:**
- 🚨 **Farm Hashrate Drop**: "Total farm hashrate dropped by 20%"
- ⚠️ **Pool Connection Issues**: "Unable to connect to mining pool"
- 🚨 **Network Issues**: "Multiple miners offline"
- ℹ️ **System Updates**: "New version available"
- ⚠️ **Power Issues**: "Farm power consumption anomaly"

**Routing Logic:**
1. Alert has no miner IP, OR
2. Alert name contains "farm", OR
3. Alert explicitly marked as farm-wide
4. Sent to all authorized Telegram users

## How It Works

### Alert Flow

```
Prometheus Alert
    ↓
Alertmanager
    ↓
Webhook → Backend Alert Service
    ↓
determineAlertRecipients()
    ↓
    ├─→ Has miner IP? → Lookup owner → Send to owner
    ├─→ Farm-wide? → Send to all users
    └─→ No owner found? → Send to all users (fallback)
    ↓
sendSmartAlert()
    ↓
Telegram Bot → Targeted delivery
```

### Code Implementation

**Alert Service** (`alert.service.ts`):
```typescript
// Determine recipients
const determineAlertRecipients = async (minerIp?: string, isFarmWide?: boolean) => {
  // Farm-wide alerts go to everyone
  if (isFarmWide || !minerIp) {
    return getAllAuthorizedUsers();
  }
  
  // Miner-specific: get owner from database
  const miner = db.getMinerByIp(minerIp);
  if (miner && miner.owner) {
    return [miner.owner]; // Owner's Telegram chat ID
  }
  
  // Fallback: send to everyone
  return getAllAuthorizedUsers();
};
```

**Telegram Service** (`telegram.service.ts`):
```typescript
export const sendSmartAlert = async (alert: {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  miner?: string;
  recipients?: string[]; // Specific chat IDs
  isFarmWide?: boolean;
}) => {
  // Route to specific recipients or all users
  const targetChatIds = alert.isFarmWide 
    ? getAllUsers() 
    : alert.recipients || getAllUsers();
  
  // Send to each recipient
  for (const chatId of targetChatIds) {
    await sendMessageToChat(chatId, message);
  }
};
```

## Configuration

### Miner Ownership

Alerts are routed based on the `owner` field in the miners database:

```sql
SELECT ip, name, owner FROM miners;
```

Example:
```
ip              name    owner
192.168.1.70    30n     427436847  ← User 1
192.168.1.53    5       427436847  ← User 1
192.168.1.65    001     246139233  ← User 2
192.168.1.63    002     246139233  ← User 2
```

**Result:**
- Alerts for `30n` and `5` → sent to user `427436847`
- Alerts for `001` and `002` → sent to user `246139233`
- Farm-wide alerts → sent to both users

### Setting Ownership

**Via Telegram Bot:**
```
/transfer 192.168.1.70 427436847
```

**Via API:**
```bash
curl -X PUT http://192.168.1.66:5000/api/miners/192.168.1.70 \
  -H "Content-Type: application/json" \
  -d '{"owner": "427436847"}'
```

**Via Database:**
```sql
UPDATE miners SET owner = '427436847' WHERE ip = '192.168.1.70';
```

## Alert Examples

### Example 1: Miner-Specific Alert

**Prometheus Alert:**
```yaml
- alert: MinerHighTemperature
  expr: miner_temp_max_c > 95
  labels:
    severity: critical
    ip: "192.168.1.70"
    miner: "30n"
  annotations:
    summary: "Miner temperature critical"
    description: "Miner 30n temperature is 98°C"
```

**Routing:**
1. Has miner IP: `192.168.1.70`
2. Lookup owner: `427436847`
3. Send to: User `427436847` only

**Telegram Message:**
```
🚨 Miner temperature critical
🔧 Miner: 30n

Miner 30n temperature is 98°C
```

### Example 2: Farm-Wide Alert

**Prometheus Alert:**
```yaml
- alert: FarmHashrateDrop
  expr: sum(miner_hashrate_ths) < 1800
  labels:
    severity: warning
  annotations:
    summary: "Farm hashrate dropped"
    description: "Total hashrate below 1800 TH/s"
```

**Routing:**
1. No miner IP → farm-wide
2. Send to: All authorized users

**Telegram Message:**
```
⚠️ Farm hashrate dropped

Total hashrate below 1800 TH/s
```

## Benefits

### For Users
✅ **Less Noise**: Only receive alerts for your miners  
✅ **Relevant Notifications**: Focus on what matters to you  
✅ **Privacy**: Don't see alerts for others' miners  
✅ **Scalability**: Works with any number of users  

### For Admins
✅ **Centralized Management**: One system, multiple users  
✅ **Flexible Ownership**: Easy to transfer miners  
✅ **Farm-Wide Visibility**: Important alerts reach everyone  
✅ **Audit Trail**: Logs show who received what  

### For Large Farms
✅ **Multi-Tenant**: Multiple owners in one farm  
✅ **Delegation**: Owners manage their miners  
✅ **Reduced Support**: Users handle their own alerts  
✅ **Better Organization**: Clear ownership structure  

## Logging

The system logs all alert routing decisions:

```
Alert fired: MinerHighTemperature - Miner temperature critical (sent to 1 owner(s))
Sending miner-specific alert to 1 owner(s) [miner: 30n]

Alert fired: FarmHashrateDrop - Farm hashrate dropped (sent to all users)
Sending farm-wide alert to 3 users
```

## Fallback Behavior

### Safety First

If the system cannot determine the owner:
1. **Fallback to all users** (ensures alert is not missed)
2. **Log warning** for investigation
3. **Continue operation** (no alert is lost)

**Example:**
```
WARN: No specific recipients, sending to all users
```

This happens when:
- Miner has no owner in database
- Database query fails
- Miner IP not found

## Alert Severity Levels

### 🚨 Critical
- Requires immediate attention
- Sent with high priority
- Examples: Offline, high temp, hardware failure

### ⚠️ Warning
- Needs attention soon
- Sent with normal priority
- Examples: Low hashrate, high rejection rate

### ℹ️ Info
- Informational only
- Sent with low priority
- Examples: Resolved alerts, system updates

## Testing

### Test Miner-Specific Alert

1. **Trigger a test alert for a specific miner:**
   ```bash
   # Simulate high temperature
   curl -X POST http://192.168.1.66:9093/api/v1/alerts \
     -d '[{
       "labels": {
         "alertname": "TestMinerAlert",
         "severity": "warning",
         "ip": "192.168.1.70",
         "miner": "30n"
       },
       "annotations": {
         "summary": "Test alert for miner 30n",
         "description": "This is a test"
       }
     }]'
   ```

2. **Verify:** Only the owner of miner `30n` receives the alert

### Test Farm-Wide Alert

1. **Trigger a farm-wide alert:**
   ```bash
   curl -X POST http://192.168.1.66:9093/api/v1/alerts \
     -d '[{
       "labels": {
         "alertname": "TestFarmAlert",
         "severity": "info"
       },
       "annotations": {
         "summary": "Test farm-wide alert",
         "description": "This should go to everyone"
       }
     }]'
   ```

2. **Verify:** All authorized users receive the alert

## Troubleshooting

### Issue: Owner not receiving alerts

**Possible causes:**
1. Miner has no owner set
2. Owner's Telegram chat ID incorrect
3. Owner not in authorized users list

**Solution:**
```bash
# Check miner ownership
curl http://192.168.1.66:5000/api/mining/miners | grep -A 5 "192.168.1.70"

# Check authorized users
# Look in .env file: TELEGRAM_CHAT_ID

# Set/update owner
curl -X PUT http://192.168.1.66:5000/api/miners/192.168.1.70 \
  -H "Content-Type: application/json" \
  -d '{"owner": "427436847"}'
```

### Issue: Everyone receiving miner-specific alerts

**Possible causes:**
1. Alert missing miner IP label
2. Fallback triggered due to missing owner

**Solution:**
1. Check Prometheus alert rules include `ip` label
2. Verify miner has owner in database
3. Check backend logs for routing decisions

### Issue: Farm-wide alerts not reaching all users

**Possible causes:**
1. Some users not in `TELEGRAM_CHAT_ID`
2. Telegram bot not initialized

**Solution:**
```bash
# Check authorized users
grep TELEGRAM_CHAT_ID /opt/mining-stack/.env

# Restart backend
docker compose restart backend
```

## Best Practices

### 1. Set Ownership for All Miners
```bash
# Assign all miners to owners
for ip in $(curl -s http://192.168.1.66:5000/api/mining/miners | jq -r '.miners[].ip'); do
  curl -X PUT http://192.168.1.66:5000/api/miners/$ip \
    -H "Content-Type: application/json" \
    -d '{"owner": "TELEGRAM_CHAT_ID"}'
done
```

### 2. Use Descriptive Alert Names
- Include "Farm" in farm-wide alert names
- Include miner identifier in miner-specific alerts
- Use clear, actionable descriptions

### 3. Set Appropriate Severity
- **Critical**: Requires immediate action
- **Warning**: Needs attention within hours
- **Info**: For awareness only

### 4. Monitor Alert Routing
```bash
# Check backend logs
docker compose logs backend | grep "alert"

# Look for routing decisions
docker compose logs backend | grep "Sending.*alert"
```

## Future Enhancements

### Planned Features
- [ ] Alert preferences per user (mute specific alert types)
- [ ] Quiet hours (no alerts during sleep time)
- [ ] Alert escalation (if not acknowledged, send to admin)
- [ ] Alert grouping (combine multiple similar alerts)
- [ ] Custom alert routing rules
- [ ] SMS/Email fallback for critical alerts

## Summary

✅ **Smart Routing**: Alerts go to the right people  
✅ **Miner-Specific**: Owners only get their miner alerts  
✅ **Farm-Wide**: Important alerts reach everyone  
✅ **Automatic**: No manual configuration needed  
✅ **Scalable**: Works for any farm size  
✅ **Safe**: Fallback ensures no alerts are missed  

**Your alerting system is now intelligent and user-aware!** 🎯
