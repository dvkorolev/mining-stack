import { Middleware } from '@reduxjs/toolkit';
import { updateStats, setConnectionStatus, setError } from '../features/mining/miningSlice';

// WebSocket URL configuration
const WS_URL = process.env.REACT_APP_WS_URL || 
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL = 2000;

export const websocketMiddleware: Middleware = (store) => {
  const connect = () => {
    if (ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('WebSocket connected');
        store.dispatch(setConnectionStatus(true));
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'mining-stats') {
            // Dispatch to Redux store
            store.dispatch(updateStats(message.data));
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        store.dispatch(setConnectionStatus(false));
        ws = null;

        // Attempt to reconnect
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(
            RECONNECT_INTERVAL * Math.pow(2, reconnectAttempts),
            30000 // Max 30 seconds
          );

          console.log(`Reconnecting in ${delay}ms... (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

          reconnectTimeout = setTimeout(() => {
            reconnectAttempts++;
            connect();
          }, delay);
        } else {
          store.dispatch(setError('WebSocket connection lost. Max reconnection attempts reached.'));
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        store.dispatch(setError('WebSocket connection error'));
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      store.dispatch(setError('Failed to create WebSocket connection'));
    }
  };

  const disconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    if (ws) {
      ws.close();
      ws = null;
    }

    store.dispatch(setConnectionStatus(false));
  };

  // Connect on initialization
  connect();

  // Cleanup on page unload
  window.addEventListener('beforeunload', disconnect);

  return (next) => (action) => {
    // You can add custom actions here to control the WebSocket
    // For example: 'websocket/connect', 'websocket/disconnect'
    
    return next(action);
  };
};

export default websocketMiddleware;
