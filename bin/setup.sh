#!/bin/bash

# Create required directories
sudo mkdir -p /opt/mining-stack/{etc,textfile,logs}

# Copy configuration files
sudo cp -r docker/alertmanager /opt/mining-stack/
sudo cp -r docker/blackbox /opt/mining-stack/
sudo cp -r docker/prometheus /opt/mining-stack/
sudo cp etc/miners.yaml /opt/mining-stack/etc/

# Set permissions
sudo chown -R $USER:$USER /opt/mining-stack
chmod +x bin/*.py

# Create a symlink for backward compatibility
sudo ln -sf /opt/mining-stack /opt/mining-monitor

echo "Setup complete. Configuration files are in /opt/mining-stack"
echo "Please edit /opt/mining-stack/etc/miners.yaml to add your miners"
