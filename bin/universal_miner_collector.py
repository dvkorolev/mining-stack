#!/usr/bin/env python3
"""
Universal Miner Stats Collector

Collects metrics from all miner types:
- Antminer (Bitmain): S19, S19 Pro, S19K Pro, etc.
- Whatsminer (MicroBT): M30S++, M50, M50S++, etc.
- DG1+ (Doge/LTC miners)
- Any cgminer-compatible miner

Exports to Prometheus textfile format without hardcoded values.
"""

import asyncio
import json
import os
import socket
import time
import yaml
from pathlib import Path
from typing import Dict, List, Optional, Any
import aiohttp
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class MinerAPI:
    """Base class for miner API communication"""
    
    def __init__(self, ip: str, model: str, alias: str):
        self.ip = ip
        self.model = model
        self.alias = alias
        self.miner_type = self._detect_miner_type()
    
    def _detect_miner_type(self) -> str:
        """Detect miner type from model string"""
        model_lower = self.model.lower()
        if 's19' in model_lower or 'antminer' in model_lower:
            return 'antminer'
        elif 'm30' in model_lower or 'm50' in model_lower or 'whatsminer' in model_lower:
            return 'whatsminer'
        elif 'dg1' in model_lower:
            return 'dg1plus'
        else:
            return 'cgminer'  # Generic cgminer-compatible
    
    async def get_stats(self) -> Optional[Dict[str, Any]]:
        """Get stats from miner - tries all known methods"""
        
        # Try cgminer API first (port 4028) - works for most miners
        cgminer_stats = await self._get_cgminer_stats()
        if cgminer_stats:
            return cgminer_stats
        
        # Try HTTP API for DG1+ and some Whatsminers
        http_stats = await self._get_http_stats()
        if http_stats:
            return http_stats
        
        logger.warning(f"Failed to get stats from {self.ip} ({self.model})")
        return None
    
    async def _get_cgminer_stats(self) -> Optional[Dict[str, Any]]:
        """Get stats via cgminer API (port 4028)"""
        try:
            # Create socket connection (longer timeout for Antminers)
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.ip, 4028),
                timeout=10.0
            )
            
            # Send stats command
            command = json.dumps({"command": "stats"})
            writer.write(command.encode())
            await writer.drain()
            
            # Read response (longer timeout)
            data = await asyncio.wait_for(reader.read(65536), timeout=10.0)
            writer.close()
            await writer.wait_closed()
            
            # Parse JSON response (handle multiple responses from Antminer)
            response = self._parse_json_response(data.decode())
            
            # Also get summary and pools for additional data
            summary = await self._get_cgminer_summary()
            pools = await self._get_cgminer_pools()
            
            return self._parse_cgminer_response(response, summary, pools)
            
        except asyncio.TimeoutError:
            logger.warning(f"cgminer API timeout for {self.ip} after 10s")
            return None
        except Exception as e:
            logger.warning(f"cgminer API failed for {self.ip}: {type(e).__name__}: {e}")
            return None
    
    async def _get_cgminer_summary(self) -> Optional[Dict[str, Any]]:
        """Get summary via cgminer API"""
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.ip, 4028),
                timeout=10.0
            )
            
            command = json.dumps({"command": "summary"})
            writer.write(command.encode())
            await writer.drain()
            
            data = await asyncio.wait_for(reader.read(65536), timeout=10.0)
            writer.close()
            await writer.wait_closed()
            
            return self._parse_json_response(data.decode())
            
        except Exception as e:
            logger.debug(f"cgminer summary failed for {self.ip}: {e}")
            return None
    
    async def _get_cgminer_pools(self) -> Optional[Dict[str, Any]]:
        """Get pool stats via cgminer API"""
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.ip, 4028),
                timeout=10.0
            )
            
            command = json.dumps({"command": "pools"})
            writer.write(command.encode())
            await writer.drain()
            
            data = await asyncio.wait_for(reader.read(65536), timeout=10.0)
            writer.close()
            await writer.wait_closed()
            
            return self._parse_json_response(data.decode())
            
        except Exception as e:
            logger.debug(f"cgminer pools failed for {self.ip}: {e}")
            return None
    
    def _parse_json_response(self, data: str) -> Dict[str, Any]:
        """Parse JSON response, handling multiple concatenated responses from Antminer"""
        try:
            # Try normal JSON parse first
            return json.loads(data)
        except json.JSONDecodeError as e:
            # Antminer may send multiple JSON objects concatenated
            # Find the first complete JSON object
            try:
                # Find the position where the first JSON ends
                decoder = json.JSONDecoder()
                obj, idx = decoder.raw_decode(data)
                return obj
            except:
                # If that fails, try to clean up the data
                # Remove null bytes and extra data
                cleaned = data.strip('\x00').split('\x00')[0]
                return json.loads(cleaned)
    
    async def _get_http_stats(self) -> Optional[Dict[str, Any]]:
        """Get stats via HTTP API (for DG1+ and some others)"""
        try:
            async with aiohttp.ClientSession() as session:
                # Try DG1+ endpoint
                async with session.get(
                    f"http://{self.ip}/cgi-bin/stats.cgi",
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        return self._parse_dg1plus_response(data)
        except Exception as e:
            logger.debug(f"HTTP API failed for {self.ip}: {e}")
            return None
    
    def _parse_cgminer_response(self, stats: Dict, summary: Optional[Dict], pools: Optional[Dict] = None) -> Dict[str, Any]:
        """Parse cgminer stats response into unified format"""
        result = {
            'ip': self.ip,
            'model': self.model,
            'alias': self.alias,
            'miner_type': self.miner_type,
            'hashrate_ths': 0,
            'hashrate_ghs': 0,
            'temperature': 0,
            'temp_max': 0,
            'power_watts': 0,
            'fan_speeds': [],
            'uptime': 0,
            'accepted_shares': 0,
            'rejected_shares': 0,
            'hw_errors': 0,
            'online': True,
        }
        
        try:
            # Get stats data
            if 'STATS' in stats and len(stats['STATS']) > 1:
                stat_data = stats['STATS'][1]  # Index 1 contains actual stats
                
                # Hashrate (convert GH/s to TH/s)
                if 'GHS av' in stat_data:
                    result['hashrate_ghs'] = float(stat_data['GHS av'])
                    result['hashrate_ths'] = result['hashrate_ghs'] / 1000.0
                elif 'GHS 5s' in stat_data:
                    result['hashrate_ghs'] = float(stat_data['GHS 5s'])
                    result['hashrate_ths'] = result['hashrate_ghs'] / 1000.0
                
                # Temperature
                temps = []
                for i in range(1, 10):  # Check temp1-temp9
                    if f'temp{i}' in stat_data:
                        temp = stat_data[f'temp{i}']
                        if temp and temp > 0:
                            temps.append(float(temp))
                    if f'temp2_{i}' in stat_data:
                        temp = stat_data[f'temp2_{i}']
                        if temp and temp > 0:
                            temps.append(float(temp))
                
                if temps:
                    result['temperature'] = sum(temps) / len(temps)
                    result['temp_max'] = max(temps)
                
                # Fan speeds
                fans = []
                for i in range(1, 10):  # Check fan1-fan9
                    if f'fan{i}' in stat_data:
                        fan = stat_data[f'fan{i}']
                        if fan and fan > 0:
                            fans.append(int(fan))
                result['fan_speeds'] = fans
                
                # Uptime
                if 'Elapsed' in stat_data:
                    result['uptime'] = int(stat_data['Elapsed'])
                
                # Hardware errors
                hw_errors = 0
                for i in range(1, 10):
                    if f'chain_hw{i}' in stat_data:
                        hw_errors += int(stat_data.get(f'chain_hw{i}', 0))
                result['hw_errors'] = hw_errors
            
            # Get summary data for shares, power, and hashrate
            # Handle two response formats:
            # 1. Standard: {"SUMMARY": [{"MHS av": ...}]}
            # 2. Alternative: {"Msg": {"MHS av": ...}}
            summary_data = None
            if summary:
                if 'SUMMARY' in summary and len(summary['SUMMARY']) > 0:
                    summary_data = summary['SUMMARY'][0]
                elif 'Msg' in summary and isinstance(summary['Msg'], dict):
                    summary_data = summary['Msg']
            
            if summary_data:
                
                # Hashrate from summary (Whatsminer uses MHS av)
                if result['hashrate_ths'] == 0:
                    if 'MHS av' in summary_data:
                        # Whatsminer reports in MH/s
                        result['hashrate_ghs'] = float(summary_data['MHS av']) / 1000.0
                        result['hashrate_ths'] = result['hashrate_ghs'] / 1000.0
                    elif 'GHS av' in summary_data:
                        result['hashrate_ghs'] = float(summary_data['GHS av'])
                        result['hashrate_ths'] = result['hashrate_ghs'] / 1000.0
                    elif 'MHS 5s' in summary_data:
                        result['hashrate_ghs'] = float(summary_data['MHS 5s']) / 1000.0
                        result['hashrate_ths'] = result['hashrate_ghs'] / 1000.0
                    elif 'GHS 5s' in summary_data:
                        result['hashrate_ghs'] = float(summary_data['GHS 5s'])
                        result['hashrate_ths'] = result['hashrate_ghs'] / 1000.0
                
                # Shares - try multiple field names
                # Antminer uses: Accepted, Rejected
                # Whatsminer may use: accepted, rejected (lowercase) or other variants
                if 'Accepted' in summary_data:
                    result['accepted_shares'] = int(summary_data['Accepted'])
                elif 'accepted' in summary_data:
                    result['accepted_shares'] = int(summary_data['accepted'])
                
                if 'Rejected' in summary_data:
                    result['rejected_shares'] = int(summary_data['Rejected'])
                elif 'rejected' in summary_data:
                    result['rejected_shares'] = int(summary_data['rejected'])
                
                # Log summary data for debugging if shares not found
                if result['accepted_shares'] == 0 and result['rejected_shares'] == 0:
                    logger.debug(f"No share data in summary for {self.ip}. Available fields: {list(summary_data.keys())}")
                
                # Power (Whatsminer specific)
                if 'Power' in summary_data:
                    result['power_watts'] = float(summary_data['Power'])
                
                # Temperature from summary (fallback)
                if result['temperature'] == 0:
                    if 'Temperature' in summary_data:
                        result['temperature'] = float(summary_data['Temperature'])
                    elif 'Chip Temp Avg' in summary_data:
                        result['temperature'] = float(summary_data['Chip Temp Avg'])
                    
                    # Also set temp_max if available
                    if 'Chip Temp Max' in summary_data:
                        result['temp_max'] = float(summary_data['Chip Temp Max'])
                
                # Uptime from summary (fallback)
                if result['uptime'] == 0 and 'Elapsed' in summary_data:
                    result['uptime'] = int(summary_data['Elapsed'])
            
            # Get pool data for shares (Whatsminer provides this in pools command)
            if pools and 'POOLS' in pools:
                accepted_total = 0
                rejected_total = 0
                
                for pool in pools['POOLS']:
                    # Pool data may have Accepted/Rejected or accepted/rejected
                    if 'Accepted' in pool:
                        accepted_total += int(pool['Accepted'])
                    elif 'accepted' in pool:
                        accepted_total += int(pool['accepted'])
                    
                    if 'Rejected' in pool:
                        rejected_total += int(pool['Rejected'])
                    elif 'rejected' in pool:
                        rejected_total += int(pool['rejected'])
                
                # Use pool data if we didn't get it from summary
                if result['accepted_shares'] == 0 and accepted_total > 0:
                    result['accepted_shares'] = accepted_total
                if result['rejected_shares'] == 0 and rejected_total > 0:
                    result['rejected_shares'] = rejected_total
            
        except Exception as e:
            logger.error(f"Error parsing cgminer response for {self.ip}: {e}")
        
        return result
    
    def _parse_dg1plus_response(self, data: Dict) -> Dict[str, Any]:
        """Parse DG1+ HTTP API response"""
        result = {
            'ip': self.ip,
            'model': self.model,
            'alias': self.alias,
            'miner_type': 'dg1plus',
            'hashrate_ths': 0,
            'hashrate_ghs': 0,
            'hashrate_mhs': 0,
            'temperature': 0,
            'temp_max': 0,
            'power_watts': 0,
            'fan_speeds': [],
            'uptime': 0,
            'accepted_shares': 0,
            'rejected_shares': 0,
            'hw_errors': 0,
            'online': True,
        }
        
        try:
            if 'STATS' in data and len(data['STATS']) > 0:
                stats = data['STATS'][0]
                
                # Hashrate (DG1+ reports in MH/s for Scrypt)
                if 'rate_5s' in stats:
                    result['hashrate_mhs'] = float(stats['rate_5s'])
                    result['hashrate_ghs'] = result['hashrate_mhs'] / 1000.0
                    result['hashrate_ths'] = result['hashrate_ghs'] / 1000.0
                
                # Temperature from chains
                if 'chain' in stats:
                    temps = []
                    for chain in stats['chain']:
                        if 'temp_chip' in chain:
                            for temp_str in chain['temp_chip']:
                                if temp_str and temp_str != '':
                                    try:
                                        temp = int(temp_str) / 1000.0  # Convert from millidegrees
                                        if temp > 0:
                                            temps.append(temp)
                                    except:
                                        pass
                    if temps:
                        result['temperature'] = sum(temps) / len(temps)
                        result['temp_max'] = max(temps)
                
                # Fan speeds
                if 'fan' in stats:
                    result['fan_speeds'] = [int(f) for f in stats['fan'] if f and int(f) > 0]
                
                # Uptime
                if 'elapsed' in stats:
                    result['uptime'] = int(stats['elapsed'])
                
                # Hardware errors
                if 'chain' in stats:
                    hw_total = 0
                    for chain in stats['chain']:
                        hw_total += int(chain.get('hw', 0))
                    result['hw_errors'] = hw_total
            
        except Exception as e:
            logger.error(f"Error parsing DG1+ response for {self.ip}: {e}")
        
        return result


async def collect_miner_stats(miner_config: Dict) -> Optional[Dict[str, Any]]:
    """Collect stats from a single miner"""
    ip = miner_config['ip']
    model = miner_config.get('model', 'Unknown')
    alias = miner_config.get('alias', ip)
    
    logger.info(f"Collecting stats from {alias} ({ip})...")
    
    try:
        miner = MinerAPI(ip, model, alias)
        stats = await miner.get_stats()
        
        if stats:
            logger.info(f"✓ {alias}: {stats['hashrate_ths']:.2f} TH/s, {stats['temperature']:.1f}°C, {stats['power_watts']}W")
            return stats
        else:
            logger.warning(f"✗ {alias}: Failed to collect stats")
            return {
                'ip': ip,
                'model': model,
                'alias': alias,
                'online': False,
            }
    
    except Exception as e:
        logger.error(f"Error collecting stats from {alias} ({ip}): {e}")
        return {
            'ip': ip,
            'model': model,
            'alias': alias,
            'online': False,
        }


def export_to_prometheus(all_stats: List[Dict[str, Any]], output_path: Path):
    """Export stats to Prometheus textfile format"""
    
    lines = []
    
    # Add header
    lines.append("# HELP miner_scrape_success Whether the miner was successfully scraped")
    lines.append("# TYPE miner_scrape_success gauge")
    
    for stats in all_stats:
        ip = stats['ip']
        model = stats['model'].replace(' ', '_').replace('(', '').replace(')', '')
        alias = stats['alias'].replace(' ', '_').replace('(', '').replace(')', '')
        online = 1 if stats.get('online', False) else 0
        
        lines.append(f'miner_scrape_success{{ip="{ip}",name="{alias}",model="{model}"}} {online}')
    
    # Hashrate metrics
    lines.append("\n# HELP miner_hashrate_ths Miner hashrate in TH/s")
    lines.append("# TYPE miner_hashrate_ths gauge")
    
    for stats in all_stats:
        if stats.get('online'):
            ip = stats['ip']
            model = stats['model'].replace(' ', '_').replace('(', '').replace(')', '')
            alias = stats['alias'].replace(' ', '_').replace('(', '').replace(')', '')
            hashrate = stats.get('hashrate_ths', 0)
            lines.append(f'miner_hashrate_ths{{ip="{ip}",name="{alias}",model="{model}"}} {hashrate}')
    
    # Temperature metrics
    lines.append("\n# HELP miner_temp_max_c Maximum temperature in Celsius")
    lines.append("# TYPE miner_temp_max_c gauge")
    
    for stats in all_stats:
        if stats.get('online'):
            ip = stats['ip']
            model = stats['model'].replace(' ', '_').replace('(', '').replace(')', '')
            alias = stats['alias'].replace(' ', '_').replace('(', '').replace(')', '')
            temp = stats.get('temp_max', stats.get('temperature', 0))
            lines.append(f'miner_temp_max_c{{ip="{ip}",name="{alias}",model="{model}"}} {temp}')
    
    # Power metrics
    lines.append("\n# HELP miner_power_watts Power consumption in watts")
    lines.append("# TYPE miner_power_watts gauge")
    
    for stats in all_stats:
        if stats.get('online'):
            ip = stats['ip']
            model = stats['model'].replace(' ', '_').replace('(', '').replace(')', '')
            alias = stats['alias'].replace(' ', '_').replace('(', '').replace(')', '')
            power = stats.get('power_watts', 0)
            lines.append(f'miner_power_watts{{ip="{ip}",name="{alias}",model="{model}"}} {power}')
    
    # Uptime metrics
    lines.append("\n# HELP miner_uptime_seconds Miner uptime in seconds")
    lines.append("# TYPE miner_uptime_seconds gauge")
    
    for stats in all_stats:
        if stats.get('online'):
            ip = stats['ip']
            model = stats['model'].replace(' ', '_').replace('(', '').replace(')', '')
            alias = stats['alias'].replace(' ', '_').replace('(', '').replace(')', '')
            uptime = stats.get('uptime', 0)
            lines.append(f'miner_uptime_seconds{{ip="{ip}",name="{alias}",model="{model}"}} {uptime}')
    
    # Fan speed metrics
    lines.append("\n# HELP miner_fan_speed_rpm Fan speed in RPM")
    lines.append("# TYPE miner_fan_speed_rpm gauge")
    
    for stats in all_stats:
        if stats.get('online') and stats.get('fan_speeds'):
            ip = stats['ip']
            model = stats['model'].replace(' ', '_').replace('(', '').replace(')', '')
            alias = stats['alias'].replace(' ', '_').replace('(', '').replace(')', '')
            for i, fan_speed in enumerate(stats['fan_speeds'], 1):
                lines.append(f'miner_fan_speed_rpm{{ip="{ip}",name="{alias}",model="{model}",fan="{i}"}} {fan_speed}')
    
    # Pool share metrics
    lines.append("\n# HELP miner_pool_accepted_total Total accepted shares")
    lines.append("# TYPE miner_pool_accepted_total counter")
    
    for stats in all_stats:
        if stats.get('online'):
            ip = stats['ip']
            model = stats['model'].replace(' ', '_').replace('(', '').replace(')', '')
            alias = stats['alias'].replace(' ', '_').replace('(', '').replace(')', '')
            accepted = stats.get('accepted_shares', 0)
            lines.append(f'miner_pool_accepted_total{{ip="{ip}",name="{alias}",model="{model}"}} {accepted}')
    
    lines.append("\n# HELP miner_pool_rejected_total Total rejected shares")
    lines.append("# TYPE miner_pool_rejected_total counter")
    
    for stats in all_stats:
        if stats.get('online'):
            ip = stats['ip']
            model = stats['model'].replace(' ', '_').replace('(', '').replace(')', '')
            alias = stats['alias'].replace(' ', '_').replace('(', '').replace(')', '')
            rejected = stats.get('rejected_shares', 0)
            lines.append(f'miner_pool_rejected_total{{ip="{ip}",name="{alias}",model="{model}"}} {rejected}')
    
    # Hardware error metrics
    lines.append("\n# HELP miner_hw_errors_total Total hardware errors")
    lines.append("# TYPE miner_hw_errors_total counter")
    
    for stats in all_stats:
        if stats.get('online'):
            ip = stats['ip']
            model = stats['model'].replace(' ', '_').replace('(', '').replace(')', '')
            alias = stats['alias'].replace(' ', '_').replace('(', '').replace(')', '')
            hw_errors = stats.get('hw_errors', 0)
            lines.append(f'miner_hw_errors_total{{ip="{ip}",name="{alias}",model="{model}"}} {hw_errors}')
    
    # Write to file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        f.write('\n'.join(lines))
        f.write('\n')
    
    logger.info(f"Exported metrics to {output_path}")


async def main():
    """Main collection loop"""
    
    # Paths
    base_path = Path(__file__).parent.parent
    config_path = base_path / 'etc' / 'miners.yaml'
    
    # Use METRICS_DIR environment variable or fallback to textfile
    metrics_dir = os.getenv('METRICS_DIR', str(base_path / 'textfile'))
    output_path = Path(metrics_dir) / 'universal_metrics.prom'
    
    # Load miner configuration
    logger.info(f"Loading miner configuration from {config_path}")
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
    
    miners = config.get('miners', [])
    logger.info(f"Found {len(miners)} miners in configuration")
    
    # Collect stats from all miners concurrently
    tasks = [collect_miner_stats(miner) for miner in miners]
    all_stats = await asyncio.gather(*tasks)
    
    # Filter out None results
    all_stats = [s for s in all_stats if s is not None]
    
    # Export to Prometheus format
    export_to_prometheus(all_stats, output_path)
    
    # Summary
    online_count = sum(1 for s in all_stats if s.get('online'))
    total_hashrate = sum(s.get('hashrate_ths', 0) for s in all_stats if s.get('online'))
    total_power = sum(s.get('power_watts', 0) for s in all_stats if s.get('online'))
    
    logger.info(f"\n=== Summary ===")
    logger.info(f"Total miners: {len(all_stats)}")
    logger.info(f"Online: {online_count}")
    logger.info(f"Total hashrate: {total_hashrate:.2f} TH/s")
    logger.info(f"Total power: {total_power:.0f} W")
    if total_power > 0:
        efficiency = (total_hashrate * 1000) / total_power
        logger.info(f"Average efficiency: {efficiency:.2f} GH/W")


if __name__ == '__main__':
    asyncio.run(main())
