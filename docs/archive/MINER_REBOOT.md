# Miner Reboot Guide

## Overview

The dashboard provides remote reboot functionality for miners, but compatibility varies by manufacturer and model.

## Supported Miners

### ✅ Whatsminer (M30S++, M50, M20 series)
**Endpoint**: `http://<ip>/cgi-bin/luci/admin/network/iface_reconnect/lan`
**Credentials**: admin/admin or root/root
**Status**: Partially supported - may require manual reboot

### ✅ Antminer (S19, S17, T19 series)
**Endpoint**: `http://<ip>/cgi-bin/reboot.cgi`
**Credentials**: root/root
**Status**: Fully supported

### ⚠️ Other Miners
**Status**: Limited support - may need manual reboot

## How to Reboot via Dashboard

### Method 1: Single Miner
1. Go to **Miners Management** page
2. Find the miner you want to reboot
3. Click **Actions** → **Reboot**
4. Confirm the action
5. Wait 2-3 minutes for miner to restart

### Method 2: Bulk Reboot
1. Go to **Miners Management** page
2. Select multiple miners (checkboxes)
3. Click **Bulk Actions** → **Reboot Selected**
4. Confirm the action

### Method 3: Via Telegram Bot
```
/reboot EN-M30SppVH90-040
```

## Manual Reboot Methods

### Via Web Interface

**Whatsminer:**
1. Open http://192.168.1.40 in browser
2. Login: admin/admin
3. Go to **System** → **Reboot**
4. Click **Reboot** button

**Antminer:**
1. Open http://192.168.1.64 in browser
2. Login: root/root
3. Go to **System** → **Reboot**
4. Click **Reboot** button

### Via SSH

**Whatsminer:**
```bash
ssh admin@192.168.1.40
# Password: admin
reboot
```

**Antminer:**
```bash
ssh root@192.168.1.64
# Password: root
reboot
```

### Via Power Cycle

**Last resort** - physically power off and on:
1. Turn off power at the switch/PDU
2. Wait 30 seconds
3. Turn power back on
4. Wait 2-3 minutes for miner to boot

## Troubleshooting

### "No compatible API found"

**Cause**: Miner doesn't support the reboot endpoints we tried.

**Solutions**:
1. **Manual reboot via web interface** (recommended)
   - Open http://<miner-ip> in browser
   - Login and use reboot button

2. **SSH reboot**:
   ```bash
   ssh admin@<miner-ip>
   reboot
   ```

3. **Power cycle** (last resort)

### Reboot Command Sent but Miner Still Online

**Possible causes**:
- Miner ignored the command
- Wrong credentials
- Firewall blocking request

**Solutions**:
1. Wait 2-3 minutes (some miners delay reboot)
2. Try manual reboot via web interface
3. Check miner logs for errors

### Miner Offline After Reboot

**Normal behavior**: Miner will be offline for 2-3 minutes during reboot.

**If still offline after 5 minutes**:
1. Check physical power connection
2. Check network cable
3. Ping the miner: `ping 192.168.1.40`
4. Check miner web interface
5. Power cycle if necessary

## Default Credentials

### Whatsminer
- **Username**: admin
- **Password**: admin
- **HTTPS**: Some models support HTTPS (port 443)

### Antminer
- **Username**: root
- **Password**: root
- **HTTPS**: Newer models (S19 XP, S19k Pro) support HTTPS

### ⚠️ Security Note
Change default passwords after initial setup! Default credentials are a security risk.

## HTTPS Support

Some miners use HTTPS instead of HTTP for their web interface.

### Configuration

Add `useHttps: true` to your miner config:

```yaml
miners:
  - ip: 192.168.1.100
    model: Antminer S19 XP
    useHttps: true  # Use HTTPS instead of HTTP
    credentials:
      username: root
      password: root
```

### Self-Signed Certificates

Most miners use self-signed SSL certificates. The system automatically accepts these certificates, so no additional configuration is needed.

### Testing HTTPS Connection

```bash
# Test if miner uses HTTPS
curl -k https://192.168.1.100

# If it works, add useHttps: true to config
```

## API Endpoints Reference

### Whatsminer M30S++/M50
```bash
# Reboot via HTTP
curl -u admin:admin "http://192.168.1.40/cgi-bin/luci/admin/network/iface_reconnect/lan"

# Or via SSH
ssh admin@192.168.1.40 "reboot"
```

### Antminer S19
```bash
# Reboot via HTTP
curl -u root:root "http://192.168.1.64/cgi-bin/reboot.cgi"

# Or via SSH
ssh root@192.168.1.64 "reboot"
```

### Generic cgminer API (port 4028)
```bash
# Check if miner supports restart command
echo '{"command":"restart"}' | nc 192.168.1.40 4028
```

## Best Practices

### When to Reboot

✅ **Good reasons**:
- Miner showing errors
- Hashrate significantly low
- Temperature issues (after fixing cooling)
- After firmware update
- Network connectivity issues

❌ **Avoid rebooting**:
- Miner is working normally
- During high pool difficulty
- Too frequently (causes wear)

### Reboot Schedule

**Recommended**: Only reboot when necessary

**If you must schedule**:
- Maximum once per week
- During low-traffic hours
- Not all miners at once (stagger reboots)

### After Reboot

1. **Wait 2-3 minutes** for miner to fully boot
2. **Check status** in dashboard
3. **Verify hashrate** returns to normal
4. **Check temperature** is stable
5. **Monitor for 15 minutes** to ensure stability

## Automation

### Automatic Reboot on Errors

**Not recommended** - Can mask underlying issues!

If you must automate:
1. Set strict conditions (e.g., offline > 10 minutes)
2. Limit reboot attempts (max 3 per day)
3. Send alert on reboot
4. Log all reboots for analysis

### Example: Reboot Script

```bash
#!/bin/bash
# Reboot miner if offline for 10 minutes

MINER_IP="192.168.1.40"
OFFLINE_THRESHOLD=600  # 10 minutes

# Check if miner is responding
if ! ping -c 3 $MINER_IP > /dev/null 2>&1; then
    echo "Miner offline, waiting..."
    sleep $OFFLINE_THRESHOLD
    
    # Check again
    if ! ping -c 3 $MINER_IP > /dev/null 2>&1; then
        echo "Miner still offline, rebooting..."
        # Power cycle via smart PDU or send reboot command
        curl -u admin:admin "http://$MINER_IP/cgi-bin/luci/admin/network/iface_reconnect/lan"
    fi
fi
```

## Limitations

### Current Implementation

- ❌ No SSH-based reboot (HTTP only)
- ❌ No custom credentials support
- ❌ No reboot confirmation from miner
- ❌ No automatic retry on failure

### Future Improvements

- ✅ Add SSH-based reboot fallback
- ✅ Support custom credentials per miner
- ✅ Verify miner actually rebooted
- ✅ Queue reboots to avoid network overload
- ✅ Reboot scheduling

## FAQ

**Q: Why does reboot fail for some miners?**
A: Different manufacturers use different APIs. Some miners don't support remote reboot at all.

**Q: Is it safe to reboot miners remotely?**
A: Yes, but:
- Don't reboot too frequently
- Ensure proper cooling before reboot
- Don't reboot all miners at once

**Q: Can I reboot miners from outside my network?**
A: Only if you have VPN or port forwarding set up. **Not recommended** for security reasons.

**Q: What if I forget the miner password?**
A: You'll need to:
1. Reset miner to factory defaults (button on miner)
2. Reconfigure from scratch
3. Or contact manufacturer support

**Q: Why does my miner take so long to reboot?**
A: Normal boot time is 2-3 minutes. Factors:
- Miner model (older = slower)
- Firmware version
- Network configuration (DHCP vs static IP)

## Summary

**Reboot via Dashboard**: Works for most miners, but may fail
**Manual Reboot**: Always works, recommended for troubleshooting
**Power Cycle**: Last resort, always works but hardest on hardware

**Best approach**: Try dashboard → Try web interface → SSH → Power cycle
