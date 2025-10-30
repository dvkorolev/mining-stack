# Mining Dashboard

A web-based dashboard for monitoring and controlling a small mining farm, built with React, Node.js, and Docker.

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
   docker-compose -f docker-compose.dev.yml up --build
   ```

3. Access the application:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5000
   - Prometheus: http://localhost:9090
   - Grafana: http://localhost:3001 (admin/mining123)

### Production Deployment

1. Create a `.env` file in the backend directory with your production settings.

2. Build and start the containers:
   ```bash
   docker-compose up -d --build
   ```

3. The application will be available at http://your-server-ip:80

## Project Structure

```
mining-dashboard/
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

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
