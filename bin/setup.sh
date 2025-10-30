#!/bin/bash

# Create required directories
sudo mkdir -p /opt/mining-monitor/{etc,textfile,logs}

# Copy configuration files
sudo cp -r docker/alertmanager /opt/mining-monitor/
sudo cp -r docker/blackbox /opt/mining-monitor/
sudo cp -r docker/prometheus /opt/mining-monitor/
sudo cp etc/miners.yaml /opt/mining-monitor/etc/

# Set permissions
sudo chown -R $USER:$USER /opt/mining-monitor
chmod +x bin/*.py

# Create a symlink for backward compatibility
sudo ln -sf /opt/mining-monitor /opt/miner-monitor

echo "Setup complete. Configuration files are in /opt/mining-monitor"
echo "Please edit /opt/mining-monitor/etc/miners.yaml to add your miners"
