# Mining Stack

A comprehensive monitoring and control system for mining operations, built with React, Node.js, and Docker. Designed to run on a Raspberry Pi or any Linux system.

## Features

- Real-time monitoring of mining statistics (hashrate, active miners, total mined)
- Historical data visualization with charts
- WebSocket support for real-time updates
- Responsive design with Material-UI
- Containerized with Docker for easy deployment
- Integrated with Prometheus and Grafana for advanced monitoring

## Prerequisites

- Docker (v20.10+)
- Docker Compose (v2.0+)
- Node.js (v16+) - Only needed for local development without Docker

## Getting Started

### Development with Docker (Recommended)

1. Clone the repository:
   ```bash
   git clone https://github.com/dvkorolev/mining-stack.git
   cd mining-stack
   ```

2. Start the development environment:
   ```bash
   docker compose -f docker-compose.dev.yml up --build
   ```

3. Access the application:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5000
   - Prometheus: http://localhost:9090
   - Grafana: http://localhost:3001 (admin/mining123)

### Raspberry Pi One‑Box Deployment (Local Network)

Deploy everything on a Raspberry Pi under a single root and access it over your tailnet.

**Canonical path (pick one and stick to it):** `/opt/mining-monitor`

**What this gives you**
- One directory tree for **code**, **configs**, and **data**.
- Prometheus, Grafana, exporters, and the mining dashboard in **one compose**.
- Services reachable on your Pi’s LAN IP (e.g., `192.168.1.66`).

**Steps**
1. On the Pi, prepare the root:
   ```bash
   sudo mkdir -p /opt/mining-monitor && sudo chown -R "$USER":"$USER" /opt/mining-monitor
   cd /opt/mining-monitor
   git clone https://github.com/dvkorolev/mining-stack.git .
   ```
   > If you previously used `/opt/miner-monitor`, create a temporary symlink during migration:
   > `sudo ln -s /opt/mining-monitor /opt/miner-monitor`

2. Make sure your **compose file** exposes services on the Pi’s LAN IP (examples):
   ```yaml
   # Replace 192.168.1.66 with your Pi's IP; or use "0.0.0.0" to listen on all interfaces
   ports:
     - "192.168.1.66:9090:9090"   # Prometheus
     - "192.168.1.66:3001:3000"   # Grafana (container 3000 → host 3001)
     - "192.168.1.66:9093:9093"   # Alertmanager
     - "192.168.1.66:3100:3100"   # Loki
   ```
   Keep `node-exporter` with the textfile collector mounted **read-only**, and run your `pyasic` collector as a separate service that writes to the shared `./textfile` directory.

3. Start the stack:
   ```bash
   docker compose up -d
   ```

4. Access over LAN:
   - Grafana → http://<Pi-IP>:3001 (default admin/mining123 — change this in Grafana env)
   - Prometheus → http://<Pi-IP>:9090
   - Alertmanager → http://<Pi-IP>:9093

**Notes**
- Store Prometheus and Grafana data on SSD/USB if possible (avoid SD card wear).
- Keep friendly miner names **out of Prometheus labels**; use stable IDs in labels and show friendly names only in the UI.
- Emit `miner_scrape_success{reason="..."}` on failures; avoid writing zeros for unknown values.

#### Raspberry Pi One-Box Deployment (Local Network)

Deploy everything on a Raspberry Pi under a single root and access it over your tailnet.

**Canonical path (pick one and stick to it):** `/opt/mining-monitor`

**What this gives you**
- One directory tree for **code**, **configs**, and **data**.
- Prometheus, Grafana, exporters, and the mining dashboard in **one compose**.
- Services reachable on your Pi's LAN IP (e.g., `192.168.1.66`).

**Steps**
1. On the Pi, prepare the root:
   ```bash
   sudo mkdir -p /opt/mining-monitor && sudo chown -R "$USER":"$USER" /opt/mining-monitor
   cd /opt/mining-monitor
   git clone https://github.com/dvkorolev/mining-stack.git .
   ```
   > If you previously used `/opt/miner-monitor`, create a temporary symlink during migration:
   > `sudo ln -s /opt/mining-monitor /opt/miner-monitor`

2. Make sure your **compose file** exposes services on the Pi's LAN IP (examples):
   ```yaml
   # Replace 192.168.1.66 with your Pi's IP; or use "0.0.0.0" to listen on all interfaces
   ports:
     - "192.168.1.66:9090:9090"   # Prometheus
     - "192.168.1.66:3001:3000"   # Grafana (container 3000 → host 3001)
     - "192.168.1.66:9093:9093"   # Alertmanager
     - "192.168.1.66:3100:3100"   # Loki
   ```
   Keep `node-exporter` with the textfile collector mounted **read-only**, and run your `pyasic` collector as a separate service that writes to the shared `./textfile` directory.

3. Start the stack:
   ```bash
   docker compose up -d
   ```

4. Access over LAN:
   - Grafana → http://<Pi-IP>:3001 (default admin/mining123 — change this in Grafana env)
   - Prometheus → http://<Pi-IP>:9090
   - Alertmanager → http://<Pi-IP>:9093

**Notes**
- Store Prometheus and Grafana data on SSD/USB if possible (avoid SD card wear).
- Keep friendly miner names **out of Prometheus labels**; use stable IDs in labels and show friendly names only in the UI.
- Emit `miner_scrape_success{reason="..."}` on failures; avoid writing zeros for unknown values.

### Production Deployment

1. Create a `.env` file in the backend directory with your production settings.

2. Build and start the containers:
   ```bash
   docker compose up -d --build
   ```

3. The application will be available at http://your-server-ip:80

## Project Structure

```
mining-stack/
├── backend/               # Node.js backend
│   ├── src/               # Source code
│   │   ├── config/        # Configuration files
│   │   ├── controllers/   # Request handlers
│   │   ├── middleware/    # Express middleware
│   │   ├── models/        # Data models
│   │   ├── routes/        # API routes
│   │   ├── services/      # Business logic
│   │   ├── server.ts      # Entry point
│   │   └── ...
│   ├── Dockerfile         # Production Dockerfile
│   ├── Dockerfile.dev     # Development Dockerfile
│   ├── package.json       # Backend dependencies
│   └── tsconfig.json      # TypeScript config
│
├── frontend/              # React frontend
│   ├── public/            # Static files
│   ├── src/               # Source code
│   │   ├── components/    # Reusable UI components
│   │   ├── features/      # Feature modules
│   │   ├── pages/         # Page components
│   │   ├── services/      # API services
│   │   ├── store/         # Redux store
│   │   ├── App.tsx        # Main app component
│   │   └── ...
│   ├── Dockerfile         # Production Dockerfile
│   ├── package.json       # Frontend dependencies
│   └── tsconfig.json      # TypeScript config
│
├── docker/                # Docker configuration
│   └── prometheus/        # Prometheus config
├── docker-compose.yml     # Production compose file
├── docker-compose.dev.yml # Development compose file
└── README.md             # This file
```

## API Endpoints

### Mining

- `GET /api/mining/stats` - Get current mining statistics
- `POST /api/mining/start` - Start mining
- `POST /api/mining/stop` - Stop mining
- `POST /api/mining/restart/:minerId` - Restart a specific miner
- `PUT /api/mining/config/:minerId` - Update miner configuration

### Health

- `GET /health` - Health check endpoint

## WebSocket Events

The application uses WebSockets for real-time updates. The following events are available:

- `mining-stats` - Emitted when mining statistics are updated

## Monitoring

The application includes Prometheus and Grafana for monitoring:

- Prometheus is available at http://localhost:9090
- Grafana is available at http://localhost:3001 (admin/mining123)

When deployed on the Pi in a local network, expose ports on the Pi's LAN IP (or restrict access via your router/firewall).

When deployed on the Pi in a local network, expose ports on the Pi’s LAN IP (or restrict access via your router/firewall).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
