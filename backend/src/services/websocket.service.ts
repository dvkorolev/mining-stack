import { Server as HTTPServer } from 'http';
import { Server, WebSocket } from 'ws';
import { config } from '../config/config';
import { getMiningStats } from './mining.service';

interface Client extends WebSocket {
  id: string;
  isAlive: boolean;
}

let wss: Server;

const setupWebSocket = (server: HTTPServer) => {
  wss = new Server({ server, path: '/ws' });

  // Handle new connections
  wss.on('connection', (ws: Client) => {
    ws.id = Math.random().toString(36).substr(2, 9);
    ws.isAlive = true;

    console.log(`Client connected: ${ws.id}`);

    // Handle pong messages
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle client disconnection
    ws.on('close', () => {
      console.log(`Client disconnected: ${ws.id}`);
    });
  });

  // Ping all clients periodically to check connection status
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = ws as Client;
      if (!client.isAlive) {
        console.log(`Terminating dead connection: ${client.id}`);
        return client.terminate();
      }

      client.isAlive = false;
      client.ping();
    });
  }, config.websocket.pingInterval);

  // Clean up interval on server shutdown
  wss.on('close', () => {
    clearInterval(interval);
  });
};

// Broadcast data to all connected clients
const broadcast = (data: any) => {
  if (!wss) return;

  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

export { setupWebSocket, broadcast };
