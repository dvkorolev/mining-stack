#!/usr/bin/env python3
import asyncio
import sys
import os
import yaml
from pyasic import get_miner

# --- Configuration ---
INVENTORY_PATH = "/opt/mining-stack/etc/miners.yaml"
METRICS_DIR = os.getenv('METRICS_DIR', '/opt/mining-stack/textfile')
OUT_PATH = f"{METRICS_DIR}/pyasic_metrics.prom"
MAX_CONCURRENT_REQUESTS = 5
# ---------------------

sem = None

async def get_miner_data(ip: str, name: str, model: str):
    async with sem:
        base_labels = {'ip': ip, 'name': name, 'model': model.replace(" ", "_")}
        def format_labels(extra_labels={}):
            all_labels = {**base_labels, **extra_labels}
            return ",".join([f'{k}="{v}"' for k, v in all_labels.items()])

        lines = []
        try:
            miner = await asyncio.wait_for(get_miner(ip), timeout=15)
            if not miner:
                lines.append(f'miner_scrape_success{{{format_labels()}}} 0')
                return lines

            data = await asyncio.wait_for(miner.get_data(), timeout=15)
            if not data:
                lines.append(f'miner_scrape_success{{{format_labels()}}} 0')
                return lines

            # --- Group 1: General Metrics ---
            hashrate_ths = data.hashrate if data.hashrate is not None else 0
            power_w = data.wattage if data.wattage is not None else 0
            is_mining = 1 if data.is_mining else 0
            uptime_seconds = data.uptime if data.uptime is not None else 0
            efficiency = data.efficiency if data.efficiency is not None else 0
            fault_light = 1 if data.fault_light else 0
            errors_count = len(data.errors) if data.errors is not None else 0
            
            # Universal max temperature calculation
            temp_max = 0
            if data.hashboards:
                all_temps = [b.chip_temp for b in data.hashboards if b.chip_temp is not None] + \
                            [b.temp for b in data.hashboards if b.temp is not None]
                if all_temps:
                    temp_max = max(all_temps)

            labels_str = format_labels()
            lines.append(f'miner_hashrate_ths{{{labels_str}}} {float(hashrate_ths):.4f}')
            lines.append(f'miner_power_watts{{{labels_str}}} {power_w}')
            lines.append(f'miner_temp_max_c{{{labels_str}}} {temp_max}')
            lines.append(f'miner_is_mining{{{labels_str}}} {is_mining}')
            lines.append(f'miner_uptime_seconds{{{labels_str}}} {uptime_seconds}')
            lines.append(f'miner_efficiency_j_th{{{labels_str}}} {efficiency}')
            lines.append(f'miner_fault_light_on{{{labels_str}}} {fault_light}')
            lines.append(f'miner_errors_count{{{labels_str}}} {errors_count}')
            lines.append(f'miner_scrape_success{{{labels_str}}} 1')

            # --- Group 2: Detailed Component Metrics ---
            if data.hashboards:
                for board in data.hashboards:
                    board_labels_str = format_labels({'slot': board.slot})
                    board_hashrate = board.hashrate if board.hashrate is not None else 0
                    board_chips = board.chips if board.chips is not None else 0
                    board_expected_chips = board.expected_chips if board.expected_chips is not None else 0
                    
                    board_temp = 0
                    if board.chip_temp is not None: board_temp = board.chip_temp
                    elif board.temp is not None: board_temp = board.temp

                    lines.append(f'miner_board_hashrate_ths{{{board_labels_str}}} {float(board_hashrate):.4f}')
                    lines.append(f'miner_board_temp_c{{{board_labels_str}}} {board_temp}')
                    lines.append(f'miner_board_chips_count{{{board_labels_str}}} {board_chips}')
                    lines.append(f'miner_board_chips_expected{{{board_labels_str}}} {board_expected_chips}')

            if data.fans:
                for i, fan in enumerate(data.fans):
                    fan_labels_str = format_labels({'fan_id': i})
                    fan_speed = fan.speed if fan.speed is not None else 0
                    lines.append(f'miner_fan_speed_rpm{{{fan_labels_str}}} {fan_speed}')
            
            if data.fan_psu:
                fan_psu_labels_str = format_labels({'fan_id': 'psu'})
                fan_psu_speed = data.fan_psu[0].speed if data.fan_psu[0].speed is not None else 0
                lines.append(f'miner_fan_speed_rpm{{{fan_psu_labels_str}}} {fan_psu_speed}')

            if data.pools:
                accepted_total = sum(p.accepted for p in data.pools if p.accepted is not None)
                rejected_total = sum(p.rejected for p in data.pools if p.rejected is not None)
                lines.append(f'miner_pool_accepted_total{{{labels_str}}} {accepted_total}')
                lines.append(f'miner_pool_rejected_total{{{labels_str}}} {rejected_total}')

        except Exception as e:
            lines.append(f'miner_scrape_success{{{format_labels()}}} 0')

        return lines

async def main():
    global sem
    sem = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    try:
        with open(INVENTORY_PATH, 'r') as f:
            inventory = yaml.safe_load(f)
        miners_to_poll = inventory.get('miners', [])
    except Exception as e:
        print(f"Error reading inventory: {e}")
        sys.exit(1)

    tasks = [get_miner_data(m['ip'], m.get('alias', m.get('name', 'Unknown')), m.get('model', 'Unknown')) for m in miners_to_poll]
    results = await asyncio.gather(*tasks)
    all_lines = [line for sublist in results for line in sublist]

    temp_path = OUT_PATH + ".tmp"
    with open(temp_path, "w") as f:
        # HELP text for all metrics
        f.write("# HELP miner_hashrate_ths Reported hashrate in TH/s\n# TYPE miner_hashrate_ths gauge\n")
        f.write("# HELP miner_power_watts Power consumption in Watts\n# TYPE miner_power_watts gauge\n")
        f.write("# HELP miner_temp_max_c Max board/chip temperature in Celsius\n# TYPE miner_temp_max_c gauge\n")
        f.write("# HELP miner_is_mining Mining status (1=mining, 0=not mining)\n# TYPE miner_is_mining gauge\n")
        f.write("# HELP miner_uptime_seconds Uptime since last reboot\n# TYPE miner_uptime_seconds counter\n")
        f.write("# HELP miner_efficiency_j_th Efficiency in Joules per Terahash\n# TYPE miner_efficiency_j_th gauge\n")
        f.write("# HELP miner_fault_light_on Fault light status (1=on, 0=off)\n# TYPE miner_fault_light_on gauge\n")
        f.write("# HELP miner_errors_count Number of reported errors\n# TYPE miner_errors_count gauge\n")
        f.write("# HELP miner_board_hashrate_ths Hashrate per board\n# TYPE miner_board_hashrate_ths gauge\n")
        f.write("# HELP miner_board_temp_c Temperature per board\n# TYPE miner_board_temp_c gauge\n")
        f.write("# HELP miner_board_chips_count Active chips per board\n# TYPE miner_board_chips_count gauge\n")
        f.write("# HELP miner_board_chips_expected Expected chips per board\n# TYPE miner_board_chips_expected gauge\n")
        f.write("# HELP miner_fan_speed_rpm Fan speed in RPM\n# TYPE miner_fan_speed_rpm gauge\n")
        f.write("# HELP miner_pool_accepted_total Lifetime accepted shares\n# TYPE miner_pool_accepted_total counter\n")
        f.write("# HELP miner_pool_rejected_total Lifetime rejected shares\n# TYPE miner_pool_rejected_total counter\n")
        f.write("# HELP miner_scrape_success Scrape success\n# TYPE miner_scrape_success gauge\n")

        if all_lines:
            f.write("\n".join(all_lines) + "\n")

    os.replace(temp_path, OUT_PATH)
    print(f"Polled {len(miners_to_poll)} miners. Wrote {len(all_lines)} lines to {OUT_PATH}")

if __name__ == "__main__":
    asyncio.run(main())
