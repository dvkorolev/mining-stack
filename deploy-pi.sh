#!/bin/bash
set -e

# Configuration
PI_USER=${1:-pi}
PI_HOST=${2:-raspberrypi.local}
REMOTE_DIR="/opt/mining-monitor"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if required arguments are provided
if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <username> <hostname-or-ip> [--skip-init]"
    echo "Example: $0 pi raspberrypi.local"
    echo "Options:"
    echo "  --skip-init  Skip miner initialization (use existing config)"
    exit 1
fi

PI_USER=$1
PI_HOST=$2
REMOTE_DIR="/opt/mining-monitor"
SKIP_INIT=false

# Check for skip-init flag
if [ "$3" == "--skip-init" ]; then
    SKIP_INIT=true
fi

# Function to check command success
exit_on_failure() {
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Error: $1${NC}"
        exit 1
    fi
}

# 1. Create necessary directories on the Raspberry Pi
echo -e "${GREEN}📁 Creating directories on Raspberry Pi...${NC}"
ssh $PI_USER@$PI_HOST "
  sudo mkdir -p $REMOTE_DIR/{etc,logs,textfile,bin}
  sudo chown -R $PI_USER:$PI_USER $REMOTE_DIR
  chmod -R 755 $REMOTE_DIR
  if [ ! -L "/opt/miner-monitor" ]; then
    echo 'Creating symlink for backward compatibility...'
    sudo ln -s $REMOTE_DIR /opt/miner-monitor
  fi
"

# 2. Copy necessary files
echo -e "${GREEN}📤 Copying files to Raspberry Pi...${NC}"
rsync -avz --progress \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.gitignore' \
  . $PI_USER@$PI_HOST:$REMOTE_DIR/

# 3. Set up environment variables
echo -e "${GREEN}⚙️  Setting up environment...${NC}"
ssh $PI_USER@$PI_HOST "
  cd $REMOTE_DIR
  
  # Create .env file if it doesn't exist
  if [ ! -f ".env" ]; then
    echo 'Creating .env file...'
    cat > .env <<EOL
# Environment Configuration
NODE_ENV=production
PORT=5000
CORS_ORIGIN=*
LOG_LEVEL=info

# Mining Configuration
MINING_UPDATE_INTERVAL=5000
MINING_MAX_HISTORY=60

# Paths
LOGS_DIR=$REMOTE_DIR/logs
EOL
  fi

  # Set secure permissions for sensitive files
  chmod 600 .env
  chmod 700 $REMOTE_DIR/bin/*.py
  chmod 700 $REMOTE_DIR/bin/init_miners.sh
  
  # Ensure proper ownership and permissions for all files
  sudo chown -R $PI_USER:$PI_USER $REMOTE_DIR
  find $REMOTE_DIR -type d -exec chmod 755 {} \;
  find $REMOTE_DIR -type f -exec chmod 644 {} \;
  
  # Make scripts executable
  chmod +x $REMOTE_DIR/bin/*.py
  chmod +x $REMOTE_DIR/bin/init_miners.sh
  
  # Set special permissions for textfile directory (Prometheus needs to read)
  chmod 775 $REMOTE_DIR/textfile
  sudo chown -R $PI_USER:root $REMOTE_DIR/textfile
"

# 4. Install required system packages
echo -e "${GREEN}📦 Installing required system packages...${NC}"
ssh $PI_USER@$PI_HOST "
  # Update package lists
  sudo apt-get update
  
  # Install required packages for pyasic
  sudo apt-get install -y python3-pip python3-venv nmap
  
  # Create and activate virtual environment
  python3 -m venv $REMOTE_DIR/venv
  source $REMOTE_DIR/venv/bin/activate
  
  # Install pyasic
  pip install pyasic pyyaml
  
  # Install network tools for miner discovery
  sudo apt-get install -y net-tools
  
  # Increase max_user_watches for file watching
  echo 'fs.inotify.max_user_watches=1048576' | sudo tee -a /etc/sysctl.conf
  
  # Apply settings
  sudo sysctl -p
  
  # Set up log rotation for Docker containers
  mkdir -p /etc/docker
  echo '{"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "3"}}' | sudo tee /etc/docker/daemon.json
  
  # Restart Docker to apply changes
  sudo systemctl restart docker
"
exit_on_failure "Failed to install system packages"

# 5. Copy initialization scripts
echo -e "${GREEN}📝 Setting up miner initialization...${NC}"
scp bin/farm_init.py bin/pyasic_textfile.py $PI_USER@$PI_HOST:$REMOTE_DIR/bin/
ssh $PI_USER@$PI_HOST "
  chmod +x $REMOTE_DIR/bin/*.py
  
  # Create a wrapper script for miner initialization with proper permissions
  cat > $REMOTE_DIR/bin/init_miners.sh << 'EOL'
#!/bin/bash
set -e

# Ensure proper permissions on first run
if [ "$(id -u)" -eq 0 ]; then
    echo "Running as root, setting permissions..."
    chown -R $SUDO_USER:$SUDO_USER /opt/mining-monitor
    chmod 755 /opt/mining-monitor
    chmod 750 /opt/mining-monitor/bin
    chmod 750 /opt/mining-monitor/etc
    chmod 775 /opt/mining-monitor/textfile
    chmod 750 /opt/mining-monitor/logs
    chmod 750 /opt/mining-monitor/venv
    chmod 644 /opt/mining-monitor/etc/*.yaml
    chmod 644 /opt/mining-monitor/etc/*.yml
    chmod 750 /opt/mining-monitor/bin/*.py
    chmod 750 /opt/mining-monitor/bin/init_miners.sh
fi

# Activate virtual environment
source /opt/mining-monitor/venv/bin/activate

# Create required directories with correct permissions
mkdir -p /opt/mining-monitor/{etc,logs,textfile}
chmod 775 /opt/mining-monitor/textfile
chmod 750 /opt/mining-monitor/{etc,logs}
chown -R $SUDO_USER:$SUDO_USER /opt/mining-monitor

# Run miner discovery
if [ -f "/opt/mining-monitor/bin/farm_init.py" ]; then
    cd /opt/mining-monitor
    python3 /opt/mining-monitor/bin/farm_init.py
    
    # Ensure miners.yaml has correct permissions
    if [ -f "/opt/mining-monitor/etc/miners.yaml" ]; then
        chmod 640 /opt/mining-monitor/etc/miners.yaml
        chown $SUDO_USER:$SUDO_USER /opt/mining-monitor/etc/miners.yaml
    fi
fi

# Set up cron job for metrics collection
CRON_ENTRY="* * * * * /opt/mining-monitor/venv/bin/python3 /opt/mining-monitor/bin/pyasic_textfile.py"
TEMP_CRON=$(mktemp)

# Remove any existing entries
crontab -l 2>/dev/null | grep -v "pyasic_textfile.py" > "$TEMP_CRON" || true

# Add the new entry
echo "$CRON_ENTRY" >> "$TEMP_CRON"

# Install the new crontab
crontab "$TEMP_CRON"
rm -f "$TEMP_CRON"

echo "Miner initialization completed successfully"
EOL

  chmod +x $REMOTE_DIR/bin/init_miners.sh
"

exit_on_failure "Failed to set up miner initialization"

# 6. Run miner initialization if not skipped
if [ "$SKIP_INIT" = false ]; then
    echo -e "${YELLOW}🔍 Running miner discovery (this may take a few minutes)...${NC}"
    ssh $PI_USER@$PI_HOST "
      cd $REMOTE_DIR
      ./bin/init_miners.sh
    "
    exit_on_failure "Miner discovery failed"
    
    echo -e "${GREEN}✅ Miner discovery completed!${NC}"
    echo -e "${YELLOW}📋 Review and edit miner configuration if needed:${NC}"
    echo "ssh $PI_USER@$PI_HOST 'nano $REMOTE_DIR/etc/miners.yaml'"
else
    echo -e "${YELLOW}⚠️  Skipping miner initialization (using existing config)${NC}"
fi

#  Start services with proper permissions
echo -e "${GREEN}🚀 Starting services with proper permissions...${NC}"
ssh $PI_USER@$PI_HOST "
  # Ensure proper permissions on the remote host
  sudo chown -R $PI_USER:$PI_USER $REMOTE_DIR
  sudo chmod 755 $REMOTE_DIR
  sudo chmod 750 $REMOTE_DIR/bin
  sudo chmod 750 $REMOTE_DIR/etc
  sudo chmod 775 $REMOTE_DIR/textfile
  sudo chown -R $PI_USER:root $REMOTE_DIR/textfile
  
  # Ensure all Python scripts are executable
  find $REMOTE_DIR -name '*.py' -exec chmod 750 {} \;
  
  cd $REMOTE_DIR
  
  echo 'Stopping any running containers...'
  docker compose down || true
  
  # Clean up old containers and images
  echo 'Cleaning up old containers and images...'
  docker system prune -f
  
  echo 'Pulling latest images...'
  docker compose pull
  
  echo 'Building and starting services...'
  # Ensure the textfile directory is writable by the container
  docker compose run --rm --entrypoint "" backend sh -c 'chmod 777 /app/textfile'
  
  # Start the services
  docker compose up -d --build --remove-orphans
  
  echo 'Waiting for services to start...'
  sleep 10
  
  # Fix any permission issues that might have been caused by Docker
  sudo chown -R $PI_USER:$PI_USER $REMOTE_DIR
  sudo chmod -R g+w $REMOTE_DIR/textfile
  
  echo 'Checking service status...'
  docker compose ps
  
  echo -e "\n${GREEN}✅ Services started successfully!${NC}"
  echo -e "\n${YELLOW}📋 Next steps:${NC}"
  echo "1. Check miner status: docker compose logs -f"
  echo "2. View metrics:      cat $REMOTE_DIR/textfile/pyasic_metrics.prom"
  echo "3. Access dashboard:   http://$PI_HOST:3000"
"

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "\nAccess your services at:"
echo -e "- Dashboard:     http://$PI_HOST:3000"
echo -e "- API:           http://$PI_HOST:5000"
echo -e "- Prometheus:    http://$PI_HOST:9090"
echo -e "- Grafana:       http://$PI_HOST:3001 (admin/mining123)"

echo -e "\nTo monitor the logs, run:"
echo "ssh $PI_USER@$PI_HOST 'cd $REMOTE_DIR && docker compose logs -f'"
