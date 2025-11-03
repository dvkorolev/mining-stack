#!/usr/bin/env python3
"""
Pool Network Quality Monitor

Monitors network quality to mining pools:
- Extracts pool URLs from miners
- Tests latency (ping)
- Tests connectivity (TCP connection)
- Measures packet loss
- Exports metrics to Prometheus

Runs continuously and updates metrics every 60 seconds.
"""

import asyncio
import os
import re
import socket
import subprocess
import time
import yaml
from pathlib import Path
from typing import Dict, List, Set, Optional, Tuple
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class PoolNetworkMonitor:
    """Monitor network quality to mining pools"""
    
    def __init__(self, config_path: Path, output_path: Path):
        self.config_path = config_path
        self.output_path = output_path
        self.pools: Set[Tuple[str, int]] = set()  # (hostname, port)
        
    def load_miners_config(self) -> List[Dict]:
        """Load miners configuration"""
        try:
            with open(self.config_path, 'r') as f:
                config = yaml.safe_load(f)
            return config.get('miners', [])
        except Exception as e:
            logger.error(f"Error loading miners config: {e}")
            return []
    
    async def get_miner_pools(self, ip: str) -> List[Tuple[str, int]]:
        """Get pool URLs from miner via cgminer API"""
        pools = []
        
        try:
            # Connect to cgminer API
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip, 4028),
                timeout=5.0
            )
            
            # Send pools command
            import json
            command = json.dumps({"command": "pools"})
            writer.write(command.encode())
            await writer.drain()
            
            # Read response
            data = await asyncio.wait_for(reader.read(65536), timeout=5.0)
            writer.close()
            await writer.wait_closed()
            
            # Parse response
            response = json.loads(data.decode().strip('\x00'))
            
            if 'POOLS' in response:
                for pool in response['POOLS']:
                    url = pool.get('URL', '')
                    if url:
                        # Parse pool URL: stratum+tcp://pool.example.com:3333
                        hostname, port = self.parse_pool_url(url)
                        if hostname and port:
                            pools.append((hostname, port))
            
        except Exception as e:
            logger.debug(f"Error getting pools from {ip}: {e}")
        
        return pools
    
    def parse_pool_url(self, url: str) -> Tuple[Optional[str], Optional[int]]:
        """Parse pool URL to extract hostname and port"""
        try:
            # Remove protocol prefix
            url = re.sub(r'^(stratum\+tcp|stratum\+ssl|stratum)://', '', url)
            
            # Extract hostname and port
            if ':' in url:
                hostname, port_str = url.rsplit(':', 1)
                # Remove any path after port
                port_str = port_str.split('/')[0]
                port = int(port_str)
                return hostname, port
            else:
                # Default stratum port
                return url, 3333
                
        except Exception as e:
            logger.debug(f"Error parsing pool URL {url}: {e}")
            return None, None
    
    async def discover_pools(self) -> Set[Tuple[str, int]]:
        """Discover all pools used by miners"""
        miners = self.load_miners_config()
        all_pools = set()
        
        logger.info(f"Discovering pools from {len(miners)} miners...")
        
        tasks = [self.get_miner_pools(miner['ip']) for miner in miners]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for pools in results:
            if isinstance(pools, list):
                all_pools.update(pools)
        
        logger.info(f"Discovered {len(all_pools)} unique pools")
        for hostname, port in all_pools:
            logger.info(f"  - {hostname}:{port}")
        
        return all_pools
    
    async def ping_host(self, hostname: str, count: int = 5) -> Dict[str, float]:
        """Ping a host and return statistics"""
        try:
            # Run ping command
            result = subprocess.run(
                ['ping', '-c', str(count), '-W', '2', hostname],
                capture_output=True,
                text=True,
                timeout=15
            )
            
            # Parse output
            output = result.stdout
            
            # Extract statistics
            stats = {
                'packets_sent': count,
                'packets_received': 0,
                'packet_loss_percent': 100.0,
                'min_ms': 0.0,
                'avg_ms': 0.0,
                'max_ms': 0.0,
                'mdev_ms': 0.0,
            }
            
            # Parse packet loss
            loss_match = re.search(r'(\d+)% packet loss', output)
            if loss_match:
                stats['packet_loss_percent'] = float(loss_match.group(1))
                stats['packets_received'] = int(count * (1 - stats['packet_loss_percent'] / 100))
            
            # Parse RTT statistics
            # rtt min/avg/max/mdev = 10.123/15.456/20.789/2.345 ms
            rtt_match = re.search(r'rtt min/avg/max/mdev = ([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)', output)
            if rtt_match:
                stats['min_ms'] = float(rtt_match.group(1))
                stats['avg_ms'] = float(rtt_match.group(2))
                stats['max_ms'] = float(rtt_match.group(3))
                stats['mdev_ms'] = float(rtt_match.group(4))
            
            return stats
            
        except Exception as e:
            logger.error(f"Error pinging {hostname}: {e}")
            return {
                'packets_sent': count,
                'packets_received': 0,
                'packet_loss_percent': 100.0,
                'min_ms': 0.0,
                'avg_ms': 0.0,
                'max_ms': 0.0,
                'mdev_ms': 0.0,
            }
    
    async def test_tcp_connection(self, hostname: str, port: int) -> Dict[str, any]:
        """Test TCP connection to pool"""
        try:
            start_time = time.time()
            
            # Resolve hostname
            try:
                ip = socket.gethostbyname(hostname)
            except socket.gaierror:
                return {
                    'reachable': 0,
                    'connect_time_ms': 0.0,
                    'dns_resolved': 0,
                }
            
            # Try to connect
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(hostname, port),
                timeout=5.0
            )
            
            connect_time = (time.time() - start_time) * 1000  # ms
            
            writer.close()
            await writer.wait_closed()
            
            return {
                'reachable': 1,
                'connect_time_ms': connect_time,
                'dns_resolved': 1,
            }
            
        except asyncio.TimeoutError:
            return {
                'reachable': 0,
                'connect_time_ms': 5000.0,
                'dns_resolved': 1,
            }
        except Exception as e:
            logger.debug(f"Error connecting to {hostname}:{port}: {e}")
            return {
                'reachable': 0,
                'connect_time_ms': 0.0,
                'dns_resolved': 0,
            }
    
    async def monitor_pool(self, hostname: str, port: int) -> Dict[str, any]:
        """Monitor a single pool"""
        logger.info(f"Monitoring {hostname}:{port}")
        
        # Run tests in parallel
        ping_task = self.ping_host(hostname)
        tcp_task = self.test_tcp_connection(hostname, port)
        
        ping_stats, tcp_stats = await asyncio.gather(ping_task, tcp_task)
        
        return {
            'hostname': hostname,
            'port': port,
            **ping_stats,
            **tcp_stats,
        }
    
    def export_metrics(self, pool_stats: List[Dict]) -> None:
        """Export metrics to Prometheus format"""
        lines = []
        
        # Header
        lines.append("# HELP pool_network_reachable Pool is reachable via TCP (1=yes, 0=no)")
        lines.append("# TYPE pool_network_reachable gauge")
        
        for stats in pool_stats:
            hostname = stats['hostname']
            port = stats['port']
            reachable = stats['reachable']
            lines.append(f'pool_network_reachable{{pool="{hostname}",port="{port}"}} {reachable}')
        
        # DNS resolution
        lines.append("\n# HELP pool_network_dns_resolved Pool DNS resolves successfully (1=yes, 0=no)")
        lines.append("# TYPE pool_network_dns_resolved gauge")
        
        for stats in pool_stats:
            hostname = stats['hostname']
            port = stats['port']
            dns_resolved = stats['dns_resolved']
            lines.append(f'pool_network_dns_resolved{{pool="{hostname}",port="{port}"}} {dns_resolved}')
        
        # Connection time
        lines.append("\n# HELP pool_network_connect_time_ms Time to establish TCP connection in milliseconds")
        lines.append("# TYPE pool_network_connect_time_ms gauge")
        
        for stats in pool_stats:
            hostname = stats['hostname']
            port = stats['port']
            connect_time = stats['connect_time_ms']
            lines.append(f'pool_network_connect_time_ms{{pool="{hostname}",port="{port}"}} {connect_time}')
        
        # Ping latency
        lines.append("\n# HELP pool_network_ping_avg_ms Average ping latency in milliseconds")
        lines.append("# TYPE pool_network_ping_avg_ms gauge")
        
        for stats in pool_stats:
            hostname = stats['hostname']
            port = stats['port']
            avg_ms = stats['avg_ms']
            lines.append(f'pool_network_ping_avg_ms{{pool="{hostname}",port="{port}"}} {avg_ms}')
        
        # Ping min
        lines.append("\n# HELP pool_network_ping_min_ms Minimum ping latency in milliseconds")
        lines.append("# TYPE pool_network_ping_min_ms gauge")
        
        for stats in pool_stats:
            hostname = stats['hostname']
            port = stats['port']
            min_ms = stats['min_ms']
            lines.append(f'pool_network_ping_min_ms{{pool="{hostname}",port="{port}"}} {min_ms}')
        
        # Ping max
        lines.append("\n# HELP pool_network_ping_max_ms Maximum ping latency in milliseconds")
        lines.append("# TYPE pool_network_ping_max_ms gauge")
        
        for stats in pool_stats:
            hostname = stats['hostname']
            port = stats['port']
            max_ms = stats['max_ms']
            lines.append(f'pool_network_ping_max_ms{{pool="{hostname}",port="{port}"}} {max_ms}')
        
        # Packet loss
        lines.append("\n# HELP pool_network_packet_loss_percent Packet loss percentage")
        lines.append("# TYPE pool_network_packet_loss_percent gauge")
        
        for stats in pool_stats:
            hostname = stats['hostname']
            port = stats['port']
            packet_loss = stats['packet_loss_percent']
            lines.append(f'pool_network_packet_loss_percent{{pool="{hostname}",port="{port}"}} {packet_loss}')
        
        # Write to file
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.output_path, 'w') as f:
            f.write('\n'.join(lines))
            f.write('\n')
        
        logger.info(f"Exported metrics to {self.output_path}")
    
    async def run_once(self) -> None:
        """Run monitoring cycle once"""
        try:
            # Discover pools
            self.pools = await self.discover_pools()
            
            if not self.pools:
                logger.warning("No pools discovered, using default pools")
                # Add some common pools as fallback
                self.pools = {
                    ('pool.example.com', 3333),
                }
            
            # Monitor all pools
            tasks = [self.monitor_pool(hostname, port) for hostname, port in self.pools]
            pool_stats = await asyncio.gather(*tasks)
            
            # Export metrics
            self.export_metrics(pool_stats)
            
            # Summary
            reachable_count = sum(1 for s in pool_stats if s['reachable'])
            logger.info(f"Monitoring complete: {reachable_count}/{len(pool_stats)} pools reachable")
            
        except Exception as e:
            logger.error(f"Error in monitoring cycle: {e}")
    
    async def run_continuous(self, interval: int = 60) -> None:
        """Run monitoring continuously"""
        logger.info(f"Starting continuous pool network monitoring (interval: {interval}s)")
        
        while True:
            try:
                await self.run_once()
            except Exception as e:
                logger.error(f"Error in monitoring cycle: {e}")
            
            # Wait for next cycle
            logger.info(f"Waiting {interval} seconds until next cycle...")
            await asyncio.sleep(interval)


async def main():
    """Main entry point"""
    # Paths
    base_path = Path(__file__).parent.parent
    config_path = base_path / 'etc' / 'miners.yaml'
    
    # Use METRICS_DIR environment variable or fallback
    metrics_dir = os.getenv('METRICS_DIR', str(base_path / 'textfile'))
    output_path = Path(metrics_dir) / 'pool_network_metrics.prom'
    
    # Create monitor
    monitor = PoolNetworkMonitor(config_path, output_path)
    
    # Check if running in one-time mode (for scheduler integration)
    run_once = os.getenv('RUN_ONCE', 'false').lower() == 'true'
    
    if run_once:
        # Run once and exit (for scheduler)
        logger.info("Running in one-time mode")
        await monitor.run_once()
    else:
        # Run continuously (for standalone service)
        await monitor.run_continuous(interval=60)


if __name__ == '__main__':
    asyncio.run(main())
