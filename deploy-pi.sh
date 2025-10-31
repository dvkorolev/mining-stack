#!/bin/bash
set -e

# Configuration
PI_USER=${1:-pi}
PI_HOST=${2:-raspberrypi.local}
REMOTE_DIR="/opt/mining-stack"

# Check if we're running locally (on the Pi itself)
if [[ "$PI_HOST" == "localhost" || "$PI_HOST" == "127.0.0.1" || "$PI_HOST" == "$(hostname)" || "$PI_HOST" == "$(hostname -s)" || "$PI_HOST" == "$(hostname -f)" || "$PI_HOST" == "$(hostname -s).local" ]]; then
    echo "🔍 Detected local installation on Raspberry Pi"
    LOCAL_INSTALL=true
    PI_USER=$(whoami)
    PI_HOST="localhost"
else
    LOCAL_INSTALL=false
fi

# Function to run commands either locally or via SSH
run_cmd() {
    if [ "$LOCAL_INSTALL" = true ]; then
        eval "$1"
    else
        ssh $PI_USER@$PI_HOST "$1"
    fi
}

# Function to copy files either locally or via rsync
copy_files() {
    local src=$1
    local dest=$2
    
    if [ "$LOCAL_INSTALL" = true ]; then
        echo "📁 Copying files locally to $dest"
        rsync -a --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='.gitignore' "$src" "$dest"
    else
        echo "📤 Copying files to $PI_USER@$PI_HOST:$dest"
        rsync -avz --progress --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='.gitignore' "$src" $PI_USER@$PI_HOST:"$dest"
    fi
}

# 1. Create necessary directories
echo -e "📁 Creating directories in $REMOTE_DIR..."
run_cmd "
  # Create the target directory if it doesn't exist
  if [ ! -d \"$REMOTE_DIR\" ]; then
    sudo mkdir -p $REMOTE_DIR
  fi
  
  # Create subdirectories
  sudo mkdir -p $REMOTE_DIR/{etc,logs,textfile,bin}
  sudo chown -R $PI_USER:$PI_USER $REMOTE_DIR
  chmod -R 755 $REMOTE_DIR
  
  # Create symlink for backward compatibility (old path -> new path)
  if [ ! -L \"/opt/mining-monitor\" ]; then
    echo 'Creating symlink for backward compatibility...'
    sudo ln -sf $REMOTE_DIR /opt/mining-monitor
  else
    echo 'Symlink /opt/mining-monitor already exists, skipping...'
  fi
"

# 2. Copy necessary files
echo -e "📤 Copying files to $REMOTE_DIR..."
copy_files "./" "$REMOTE_DIR/"

# 3. Set up environment
echo -e "⚙️ Setting up environment..."
run_cmd "
  cd $REMOTE_DIR
  
  # Create init_miners.sh if it doesn't exist
  if [ ! -f \"bin/init_miners.sh\" ]; then
    echo 'Creating init_miners.sh...'
    cat > bin/init_miners.sh << 'EOL'
#!/bin/bash
set -e

# Activate virtual environment
source $REMOTE_DIR/venv/bin/activate

# Create required directories
mkdir -p $REMOTE_DIR/{etc,logs,textfile}
chmod 775 $REMOTE_DIR/textfile
chmod 750 $REMOTE_DIR/{etc,logs}

# Run miner discovery if farm_init.py exists
if [ -f \"$REMOTE_DIR/bin/farm_init.py\" ]; then
    echo 'Running miner discovery...'
    cd $REMOTE_DIR
    python3 bin/farm_init.py
    
    # Ensure miners.yaml has correct permissions
    if [ -f \"etc/miners.yaml\" ]; then
        chmod 640 etc/miners.yaml
    fi
fi

# Set up cron job for metrics collection
echo 'Setting up cron job for metrics collection...'
(crontab -l 2>/dev/null | grep -v \"pyasic_textfile.py\"; echo \"* * * * * $REMOTE_DIR/venv/bin/python3 $REMOTE_DIR/bin/pyasic_textfile.py\") | crontab -

echo 'Miner initialization completed successfully'
EOL
  fi

  # Set secure permissions
  if [ -f .env ]; then
    chmod 600 .env
  fi
  chmod 700 $REMOTE_DIR/bin/*.py 2>/dev/null || true
  chmod 700 $REMOTE_DIR/bin/init_miners.sh 2>/dev/null || true
"

# 4. Install required system packages
echo -e "📦 Installing required system packages..."
run_cmd "
  # Update package lists
  sudo apt-get update
  
  # Install required packages for pyasic
  sudo apt-get install -y python3-pip python3-venv nmap jq
  
  # Create and activate virtual environment
  python3 -m venv $REMOTE_DIR/venv
  source $REMOTE_DIR/venv/bin/activate
  
  # Install pyasic and dependencies
  pip install pyasic pyyaml netifaces
  
  # Install network tools for miner discovery
  sudo apt-get install -y net-tools
  
  # Increase max_user_watches for file watching
  echo 'fs.inotify.max_user_watches=1048576' | sudo tee -a /etc/sysctl.conf
  echo 'net.ipv4.ip_forward=1' | sudo tee -a /etc/sysctl.conf
  echo 'net.ipv6.conf.all.forwarding=1' | sudo tee -a /etc/sysctl.conf
  
  # Apply settings
  sudo sysctl -p
  
  # Set up Docker log rotation
  sudo mkdir -p /etc/docker
  echo '{
    \"log-driver\": \"json-file\",
    \"log-opts\": {
      \"max-size\": \"10m\",
      \"max-file\": \"3\"
    }
  }' | sudo tee /etc/docker/daemon.json > /dev/null

  # Restart Docker to apply changes
  echo \"Restarting Docker to apply settings...\"
  sudo systemctl restart docker
"

# 5. Start services
echo -e "🚀 Starting services..."
run_cmd "
  cd $REMOTE_DIR
  
  # Ensure proper permissions
  sudo chown -R $PI_USER:$PI_USER $REMOTE_DIR
  sudo chmod -R 755 $REMOTE_DIR
  sudo chmod -R 775 $REMOTE_DIR/textfile
  sudo chown -R $PI_USER:root $REMOTE_DIR/textfile
  
  # Stop any running containers
  echo 'Stopping any running containers...'
  docker compose down || true
  
  # Clean up old containers and images
  echo 'Cleaning up old containers and images...'
  docker system prune -f
  
  echo 'Pulling latest images...'
  docker compose pull
  
  echo 'Building and starting services...'
  docker compose up -d --build --remove-orphans
  
  echo 'Waiting for services to start...'
  sleep 10
  
  echo -e \"\n✅ Services started successfully!\"
  echo -e \"\n📋 Access your services at:\"
  echo \"- Dashboard:     http://localhost:3000\"
  echo \"- API:           http://localhost:5000\"
  echo \"- Prometheus:    http://localhost:9090\"
  echo \"- Grafana:       http://localhost:3001 (admin/mining123)\"
  echo -e \"\nTo monitor the logs, run:\"
  echo \"cd $REMOTE_DIR && docker compose logs -f\"
"