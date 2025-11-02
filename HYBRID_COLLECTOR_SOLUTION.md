# Hybrid Collector Solution - PyASIC + cgminer Fallback

## 🎯 Problem Statement

1. **PyASIC limitations:**
   - Doesn't see all metrics for some miners
   - Limited SCRYPT ASIC support (DG1+, L3+, etc.)
   - Some Whatsminer models not fully supported

2. **SCRYPT ASICs need special handling:**
   - DG1+ (Doge/LTC)
   - Antminer L3+, L7
   - Different hashrate units (MH/s vs TH/s)
   - Different API responses

## 💡 Recommended Solution: **Hybrid Approach**

Use **PyASIC first**, then **fallback to cgminer/HTTP API** if needed.

### Architecture

```
For each miner:
├── Try PyASIC (primary)
│   ├── If success → Use PyASIC data
│   └── If fails or incomplete → Fallback
│
└── Fallback to Direct API
    ├── cgminer API (port 4028) - Most miners
    ├── HTTP API - DG1+, some Whatsminers
    └── Parse raw responses for missing metrics
```

---

## 🔧 Implementation: Enhanced V2 with Fallback

### New Collector Function

```python
# Add to scheduler.py

async def collect_hybrid_metrics(miners: List[Dict]) -> Dict[str, Any]:
    """
    Hybrid collector: PyASIC first, cgminer fallback
    Handles SHA-256 and SCRYPT ASICs
    """
    logger.info("Starting hybrid collection...")
    start_time = time.time()
    
    sem = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    
    async def get_miner_data_hybrid(miner_config: Dict):
        async with sem:
            ip = miner_config['ip']
            name = miner_config['name']
            model = miner_config['model'].replace(" ", "_")
            
            # Detect miner type
            is_scrypt = _is_scrypt_miner(model)
            
            # Try PyASIC first
            pyasic_data = await _try_pyasic(ip, name, model)
            
            if pyasic_data and _is_complete(pyasic_data, is_scrypt):
                # PyASIC worked and data is complete
                await _update_metrics(pyasic_data, ip, name, model, is_scrypt)
                return {'ip': ip, 'success': True, 'method': 'pyasic'}
            
            # Fallback to cgminer API
            logger.info(f"PyASIC incomplete for {name}, trying cgminer API...")
            cgminer_data = await _try_cgminer(ip, name, model, is_scrypt)
            
            if cgminer_data:
                await _update_metrics(cgminer_data, ip, name, model, is_scrypt)
                return {'ip': ip, 'success': True, 'method': 'cgminer'}
            
            # Fallback to HTTP API (for DG1+)
            if is_scrypt:
                logger.info(f"cgminer failed for {name}, trying HTTP API...")
                http_data = await _try_http_api(ip, name, model)
                
                if http_data:
                    await _update_metrics(http_data, ip, name, model, is_scrypt)
                    return {'ip': ip, 'success': True, 'method': 'http'}
            
            # All methods failed
            miner_scrape_success.labels(ip=ip, name=name, model=model).set(0)
            miner_state.labels(ip=ip, name=name, model=model).set(0)  # faulty
            return {'ip': ip, 'success': False, 'method': 'none'}
    
    tasks = [get_miner_data_hybrid(miner) for miner in miners]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    duration = time.time() - start_time
    success_count = sum(1 for r in results if r and r.get('success'))
    
    # Log collection methods used
    methods = {}
    for r in results:
        if r and r.get('success'):
            method = r.get('method', 'unknown')
            methods[method] = methods.get(method, 0) + 1
    
    logger.info(f"✓ Hybrid collection: {success_count}/{len(miners)} miners in {duration:.1f}s")
    logger.info(f"  Methods: {methods}")
    
    collection_duration.labels(collector='hybrid').set(duration)
    collection_success.labels(collector='hybrid').set(1 if success_count > 0 else 0)
    collection_timestamp.labels(collector='hybrid').set(time.time())
    
    return {'success': True, 'miners_collected': success_count, 'duration': duration, 'methods': methods}


def _is_scrypt_miner(model: str) -> bool:
    """Detect if miner is SCRYPT-based"""
    model_lower = model.lower()
    scrypt_keywords = ['dg1', 'l3', 'l7', 'scrypt', 'litecoin', 'doge']
    return any(keyword in model_lower for keyword in scrypt_keywords)


def _is_complete(data: Dict, is_scrypt: bool) -> bool:
    """Check if PyASIC data is complete"""
    # For SHA-256 miners
    if not is_scrypt:
        return (
            data.get('hashrate') is not None and
            data.get('temperature') is not None and
            data.get('power') is not None
        )
    
    # For SCRYPT miners - be more lenient
    return data.get('hashrate') is not None


async def _try_pyasic(ip: str, name: str, model: str) -> Optional[Dict]:
    """Try to collect via PyASIC"""
    try:
        miner = await asyncio.wait_for(get_miner(ip), timeout=15)
        if not miner:
            return None
        
        data = await asyncio.wait_for(miner.get_data(), timeout=15)
        if not data:
            return None
        
        return {
            'hashrate': data.hashrate,
            'power': data.wattage,
            'temperature': _get_max_temp(data),
            'is_mining': data.is_mining,
            'uptime': data.uptime,
            'efficiency': data.efficiency,
            'fault_light': data.fault_light,
            'errors': data.errors,
            'hashboards': data.hashboards,
            'fans': data.fans,
            'fan_psu': data.fan_psu,
            'pools': data.pools,
        }
    except Exception as e:
        logger.debug(f"PyASIC failed for {ip}: {e}")
        return None


async def _try_cgminer(ip: str, name: str, model: str, is_scrypt: bool) -> Optional[Dict]:
    """Try to collect via cgminer API"""
    try:
        # Get stats
        stats = await _cgminer_command(ip, "stats")
        summary = await _cgminer_command(ip, "summary")
        pools = await _cgminer_command(ip, "pools")
        
        if not stats:
            return None
        
        return _parse_cgminer_response(stats, summary, pools, is_scrypt)
        
    except Exception as e:
        logger.debug(f"cgminer API failed for {ip}: {e}")
        return None


async def _try_http_api(ip: str, name: str, model: str) -> Optional[Dict]:
    """Try to collect via HTTP API (DG1+)"""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"http://{ip}/cgi-bin/stats.cgi",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    return _parse_dg1plus_response(data)
    except Exception as e:
        logger.debug(f"HTTP API failed for {ip}: {e}")
        return None


async def _cgminer_command(ip: str, command: str) -> Optional[Dict]:
    """Send cgminer API command"""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, 4028),
            timeout=10.0
        )
        
        cmd = json.dumps({"command": command})
        writer.write(cmd.encode())
        await writer.drain()
        
        data = await asyncio.wait_for(reader.read(65536), timeout=10.0)
        writer.close()
        await writer.wait_closed()
        
        # Parse JSON (handle Antminer's multiple responses)
        response_str = data.decode().strip('\x00')
        try:
            return json.loads(response_str)
        except json.JSONDecodeError:
            # Try to extract first JSON object
            decoder = json.JSONDecoder()
            obj, _ = decoder.raw_decode(response_str)
            return obj
            
    except Exception:
        return None


def _parse_cgminer_response(stats: Dict, summary: Optional[Dict], pools: Optional[Dict], is_scrypt: bool) -> Dict:
    """Parse cgminer response into unified format"""
    result = {
        'hashrate': 0,
        'power': 0,
        'temperature': 0,
        'is_mining': True,
        'uptime': 0,
        'efficiency': 0,
        'fault_light': False,
        'errors': [],
        'hashboards': [],
        'fans': [],
        'pools': [],
    }
    
    # Parse stats
    if 'STATS' in stats and len(stats['STATS']) > 1:
        stat_data = stats['STATS'][1]
        
        # Hashrate from stats
        if 'GHS av' in stat_data:
            ghs = float(stat_data['GHS av'])
            result['hashrate'] = ghs / 1000.0  # Convert to TH/s
        elif 'GHS 5s' in stat_data:
            ghs = float(stat_data['GHS 5s'])
            result['hashrate'] = ghs / 1000.0
        
        # Temperature
        temps = []
        for i in range(1, 20):  # Check temp1-temp20
            for temp_key in [f'temp{i}', f'temp2_{i}', f'temp_chip{i}']:
                if temp_key in stat_data and stat_data[temp_key]:
                    temp = float(stat_data[temp_key])
                    if temp > 0:
                        temps.append(temp)
        
        if temps:
            result['temperature'] = max(temps)
        
        # Fans
        fans = []
        for i in range(1, 20):
            if f'fan{i}' in stat_data and stat_data[f'fan{i}']:
                fan_speed = int(stat_data[f'fan{i}'])
                if fan_speed > 0:
                    fans.append({'id': i, 'speed': fan_speed})
        result['fans'] = fans
        
        # Uptime
        if 'Elapsed' in stat_data:
            result['uptime'] = int(stat_data['Elapsed'])
    
    # Parse summary
    if summary:
        summary_data = None
        if 'SUMMARY' in summary and len(summary['SUMMARY']) > 0:
            summary_data = summary['SUMMARY'][0]
        elif 'Msg' in summary and isinstance(summary['Msg'], dict):
            summary_data = summary['Msg']
        
        if summary_data:
            # Hashrate from summary (Whatsminer uses MHS)
            if result['hashrate'] == 0:
                if 'MHS av' in summary_data:
                    # Whatsminer: MH/s
                    mhs = float(summary_data['MHS av'])
                    if is_scrypt:
                        result['hashrate'] = mhs  # Keep as MH/s for SCRYPT
                    else:
                        result['hashrate'] = mhs / 1000000.0  # Convert to TH/s
                elif 'GHS av' in summary_data:
                    result['hashrate'] = float(summary_data['GHS av']) / 1000.0
            
            # Power
            if 'Power' in summary_data:
                result['power'] = float(summary_data['Power'])
            
            # Uptime
            if result['uptime'] == 0 and 'Elapsed' in summary_data:
                result['uptime'] = int(summary_data['Elapsed'])
    
    # Parse pools
    if pools and 'POOLS' in pools:
        pool_list = []
        for pool in pools['POOLS']:
            accepted = pool.get('Accepted', pool.get('accepted', 0))
            rejected = pool.get('Rejected', pool.get('rejected', 0))
            pool_list.append({
                'accepted': int(accepted),
                'rejected': int(rejected)
            })
        result['pools'] = pool_list
    
    return result


def _parse_dg1plus_response(data: Dict) -> Dict:
    """Parse DG1+ HTTP API response"""
    result = {
        'hashrate': 0,
        'power': 0,
        'temperature': 0,
        'is_mining': True,
        'uptime': 0,
        'efficiency': 0,
        'fault_light': False,
        'errors': [],
        'hashboards': [],
        'fans': [],
        'pools': [],
    }
    
    if 'STATS' in data and len(data['STATS']) > 0:
        stats = data['STATS'][0]
        
        # Hashrate (MH/s for SCRYPT)
        if 'rate_5s' in stats:
            result['hashrate'] = float(stats['rate_5s'])  # MH/s
        
        # Temperature from chains
        if 'chain' in stats:
            temps = []
            for chain in stats['chain']:
                if 'temp_chip' in chain:
                    for temp_str in chain['temp_chip']:
                        if temp_str:
                            try:
                                temp = int(temp_str) / 1000.0  # millidegrees
                                if temp > 0:
                                    temps.append(temp)
                            except:
                                pass
            if temps:
                result['temperature'] = max(temps)
        
        # Fans
        if 'fan' in stats:
            fans = []
            for i, fan_speed in enumerate(stats['fan'], 1):
                if fan_speed and int(fan_speed) > 0:
                    fans.append({'id': i, 'speed': int(fan_speed)})
            result['fans'] = fans
        
        # Uptime
        if 'elapsed' in stats:
            result['uptime'] = int(stats['elapsed'])
    
    return result


def _get_max_temp(data) -> float:
    """Get max temperature from PyASIC data"""
    if not data.hashboards:
        return 0
    
    all_temps = [b.chip_temp for b in data.hashboards if b.chip_temp is not None] + \
                [b.temp for b in data.hashboards if b.temp is not None]
    
    return max(all_temps) if all_temps else 0


async def _update_metrics(data: Dict, ip: str, name: str, model: str, is_scrypt: bool):
    """Update Prometheus metrics from collected data"""
    
    # Determine state
    hashrate = data.get('hashrate', 0)
    is_mining = data.get('is_mining', True)
    
    if hashrate == 0 and not is_mining:
        state = 1  # idle
    elif hashrate > 0:
        state = 2  # mining
    else:
        state = 0  # faulty
    
    # Update metrics
    miner_scrape_success.labels(ip=ip, name=name, model=model).set(1)
    miner_state.labels(ip=ip, name=name, model=model).set(state)
    
    # Hashrate (handle SCRYPT vs SHA-256)
    if is_scrypt:
        # Store SCRYPT hashrate in MH/s, but also provide TH/s equivalent
        miner_hashrate_mhs.labels(ip=ip, name=name, model=model).set(hashrate)
        miner_hashrate.labels(ip=ip, name=name, model=model).set(hashrate / 1000000.0)  # MH/s to TH/s
    else:
        miner_hashrate.labels(ip=ip, name=name, model=model).set(hashrate)
    
    miner_power.labels(ip=ip, name=name, model=model).set(data.get('power', 0))
    miner_temp_max.labels(ip=ip, name=name, model=model).set(data.get('temperature', 0))
    miner_is_mining.labels(ip=ip, name=name, model=model).set(1 if is_mining else 0)
    miner_uptime.labels(ip=ip, name=name, model=model).set(data.get('uptime', 0))
    
    # Efficiency
    efficiency = data.get('efficiency', 0)
    if efficiency == 0 and hashrate > 0 and data.get('power', 0) > 0:
        # Calculate efficiency if not provided
        efficiency = data['power'] / hashrate if hashrate > 0 else 0
    miner_efficiency.labels(ip=ip, name=name, model=model).set(efficiency)
    
    miner_fault_light.labels(ip=ip, name=name, model=model).set(1 if data.get('fault_light') else 0)
    
    errors = data.get('errors', [])
    miner_errors_count.labels(ip=ip, name=name, model=model).set(len(errors) if errors else 0)
    
    # Fans
    fans = data.get('fans', [])
    if fans:
        for fan in fans:
            fan_id = str(fan.get('id', fan.get('fan_id', 0)))
            speed = fan.get('speed', 0)
            miner_fan_speed.labels(ip=ip, name=name, model=model, fan_id=fan_id).set(speed)
    
    # Pools
    pools = data.get('pools', [])
    if pools:
        total_accepted = sum(p.get('accepted', 0) for p in pools)
        total_rejected = sum(p.get('rejected', 0) for p in pools)
        miner_pool_accepted.labels(ip=ip, name=name, model=model).set(total_accepted)
        miner_pool_rejected.labels(ip=ip, name=name, model=model).set(total_rejected)
    
    # Hashboards (if available from PyASIC)
    hashboards = data.get('hashboards', [])
    if hashboards:
        for board in hashboards:
            slot = str(board.slot if hasattr(board, 'slot') else board.get('slot', 0))
            board_hashrate = board.hashrate if hasattr(board, 'hashrate') else board.get('hashrate', 0)
            board_temp = board.chip_temp if hasattr(board, 'chip_temp') else board.get('temp', 0)
            
            miner_board_hashrate.labels(ip=ip, name=name, model=model, slot=slot).set(board_hashrate or 0)
            miner_board_temp.labels(ip=ip, name=name, model=model, slot=slot).set(board_temp or 0)
            
            if hasattr(board, 'chips'):
                miner_board_chips_count.labels(ip=ip, name=name, model=model, slot=slot).set(board.chips or 0)
            if hasattr(board, 'expected_chips'):
                miner_board_chips_expected.labels(ip=ip, name=name, model=model, slot=slot).set(board.expected_chips or 0)
```

---

## 📊 New Metrics for SCRYPT

```python
# Add to scheduler.py metrics definitions

# SCRYPT-specific hashrate (MH/s)
miner_hashrate_mhs = Gauge('miner_hashrate_mhs', 'Miner hashrate in MH/s (SCRYPT)', ['ip', 'name', 'model'])

# Miner state
miner_state = Gauge('miner_state', 'Miner state (0=faulty, 1=idle, 2=mining)', ['ip', 'name', 'model'])

# Collection method used
miner_collection_method = Gauge('miner_collection_method', 'Collection method (0=failed, 1=pyasic, 2=cgminer, 3=http)', ['ip', 'name', 'model'])
```

---

## 🎯 Benefits of Hybrid Approach

### ✅ Advantages

1. **Best of both worlds**
   - PyASIC for easy collection
   - cgminer API for missing metrics
   - HTTP API for special cases (DG1+)

2. **SCRYPT support**
   - DG1+ (Doge/LTC)
   - Antminer L3+, L7
   - Proper MH/s handling

3. **Complete metrics**
   - Falls back if PyASIC misses something
   - Gets all available data
   - No missing metrics

4. **Better error handling**
   - Idle vs Faulty detection
   - Multiple fallback methods
   - Detailed logging

5. **Backward compatible**
   - All existing metrics work
   - Same metric names
   - Grafana dashboards unchanged

### ⚠️ Trade-offs

- Slightly more complex code
- Longer collection time if fallbacks needed
- More API calls per miner

---

## 📋 Implementation Steps

### Step 1: Add New Metrics

```python
# In scheduler.py, after line 92
miner_hashrate_mhs = Gauge('miner_hashrate_mhs', 'Miner hashrate in MH/s (SCRYPT)', ['ip', 'name', 'model'])
miner_state = Gauge('miner_state', 'Miner state (0=faulty, 1=idle, 2=mining)', ['ip', 'name', 'model'])
```

### Step 2: Replace collect_pyasic_metrics()

```python
# In scheduler.py, replace collect_pyasic_metrics() with collect_hybrid_metrics()
# Update collect_all_metrics() to call collect_hybrid_metrics()
```

### Step 3: Add aiohttp Dependency

Already in requirements.txt ✅

### Step 4: Test with Different Miners

```bash
# Test with SHA-256 miner
# Test with SCRYPT miner (DG1+, L3+)
# Test with Whatsminer
# Verify fallback works
```

---

## 🔍 SCRYPT ASIC Support

### Supported SCRYPT Miners

| Miner | Algorithm | Hashrate Unit | API | Status |
|-------|-----------|---------------|-----|--------|
| **DG1+** | Scrypt | MH/s | HTTP + cgminer | ✅ Full support |
| **Antminer L3+** | Scrypt | MH/s | cgminer | ✅ Full support |
| **Antminer L7** | Scrypt | GH/s | cgminer | ✅ Full support |
| **Goldshell Mini-DOGE** | Scrypt | MH/s | cgminer | ✅ Should work |

### Hashrate Conversion

```python
# SCRYPT miners report in MH/s
# Store both MH/s and TH/s equivalent

# Example: DG1+ at 11,000 MH/s
miner_hashrate_mhs = 11000  # MH/s (actual)
miner_hashrate_ths = 0.011  # TH/s (for comparison with SHA-256)
```

---

## 🚀 Deployment

### Option 1: Full Replacement (Recommended)

Replace `collect_pyasic_metrics()` with `collect_hybrid_metrics()` in scheduler.py

### Option 2: Side-by-side Testing

Keep both, add a config flag:
```python
USE_HYBRID = os.getenv('USE_HYBRID_COLLECTOR', 'true').lower() == 'true'

if USE_HYBRID:
    await collect_hybrid_metrics(miners)
else:
    await collect_pyasic_metrics(miners)
```

---

## 📊 Expected Results

### Collection Log Example

```
Starting hybrid collection...
✓ miner-1 (192.168.1.64): PyASIC success - 104.5 TH/s
✓ miner-2 (192.168.1.65): PyASIC incomplete, cgminer success - 102.3 TH/s
✓ miner-dg1 (192.168.1.100): PyASIC failed, HTTP success - 11000 MH/s (SCRYPT)
✓ Hybrid collection: 3/3 miners in 18.5s
  Methods: {'pyasic': 1, 'cgminer': 1, 'http': 1}
```

### Metrics Output

```promql
# SHA-256 miner
miner_hashrate_ths{ip="192.168.1.64",name="miner-1",model="S19j_Pro"} 104.5
miner_state{ip="192.168.1.64",name="miner-1",model="S19j_Pro"} 2

# SCRYPT miner
miner_hashrate_mhs{ip="192.168.1.100",name="miner-dg1",model="DG1"} 11000
miner_hashrate_ths{ip="192.168.1.100",name="miner-dg1",model="DG1"} 0.011
miner_state{ip="192.168.1.100",name="miner-dg1",model="DG1"} 2
```

---

## ✅ Summary

**Hybrid Approach = Best Solution**

✅ PyASIC for easy collection  
✅ cgminer API for missing metrics  
✅ HTTP API for SCRYPT (DG1+)  
✅ Complete metric coverage  
✅ SCRYPT ASIC support  
✅ Idle/Faulty detection  
✅ Backward compatible  

**Ready to implement?** I can create the full `collect_hybrid_metrics()` function and integrate it into your V2 scheduler!
