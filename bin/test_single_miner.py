#!/usr/bin/env python3
"""
Test single miner connection
Quick diagnostic tool
"""

import asyncio
import json
import sys

async def test_miner(ip):
    """Test connection to a single miner"""
    print(f"Testing connection to {ip}...")
    
    try:
        # Connect
        print(f"  Connecting to {ip}:4028...")
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, 4028),
            timeout=15.0
        )
        print(f"  ✓ Connected!")
        
        # Send summary command
        print(f"  Sending 'summary' command...")
        command = json.dumps({"command": "summary"})
        writer.write(command.encode())
        await writer.drain()
        
        # Read response
        print(f"  Reading response...")
        data = await asyncio.wait_for(reader.read(65536), timeout=15.0)
        writer.close()
        await writer.wait_closed()
        
        # Parse
        response = json.loads(data.decode())
        print(f"  ✓ Got response!")
        
        # Extract key info
        if 'SUMMARY' in response and len(response['SUMMARY']) > 0:
            summary = response['SUMMARY'][0]
            
            # Try different hashrate fields
            hashrate = 0
            if 'MHS av' in summary:
                hashrate = float(summary['MHS av']) / 1000000.0  # MH/s to TH/s
                print(f"  Hashrate (MHS av): {hashrate:.2f} TH/s")
            elif 'GHS av' in summary:
                hashrate = float(summary['GHS av']) / 1000.0  # GH/s to TH/s
                print(f"  Hashrate (GHS av): {hashrate:.2f} TH/s")
            elif 'MHS 5s' in summary:
                hashrate = float(summary['MHS 5s']) / 1000000.0
                print(f"  Hashrate (MHS 5s): {hashrate:.2f} TH/s")
            elif 'GHS 5s' in summary:
                hashrate = float(summary['GHS 5s']) / 1000.0
                print(f"  Hashrate (GHS 5s): {hashrate:.2f} TH/s")
            
            if 'Temperature' in summary:
                print(f"  Temperature: {summary['Temperature']}°C")
            
            if 'Power' in summary:
                print(f"  Power: {summary['Power']}W")
            
            print(f"\n  Full summary keys: {list(summary.keys())}")
        
        return True
        
    except asyncio.TimeoutError:
        print(f"  ✗ Timeout after 15 seconds")
        return False
    except Exception as e:
        print(f"  ✗ Error: {type(e).__name__}: {e}")
        return False

async def main():
    if len(sys.argv) < 2:
        print("Usage: python3 test_single_miner.py <IP>")
        print("Example: python3 test_single_miner.py 192.168.1.64")
        sys.exit(1)
    
    ip = sys.argv[1]
    success = await test_miner(ip)
    
    if success:
        print(f"\n✓ SUCCESS: {ip} is responding correctly")
    else:
        print(f"\n✗ FAILED: {ip} is not responding")

if __name__ == '__main__':
    asyncio.run(main())
