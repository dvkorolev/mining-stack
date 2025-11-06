import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { MiningStatsResponse } from '../../services/api';

interface MiningState {
  stats: MiningStatsResponse | null;
  isConnected: boolean;
  lastUpdate: number | null;
  error: string | null;
}

const initialState: MiningState = {
  stats: null,
  isConnected: false,
  lastUpdate: null,
  error: null,
};

const miningSlice = createSlice({
  name: 'mining',
  initialState,
  reducers: {
    // Update stats from WebSocket or API
    updateStats: (state, action: PayloadAction<MiningStatsResponse>) => {
      state.stats = action.payload;
      state.lastUpdate = Date.now();
      state.error = null;
    },
    
    // Set WebSocket connection status
    setConnectionStatus: (state, action: PayloadAction<boolean>) => {
      state.isConnected = action.payload;
    },
    
    // Set error message
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
    },
    
    // Clear error
    clearError: (state) => {
      state.error = null;
    },
    
    // Optimistic update: Set miner status immediately
    setMinerStatusOptimistic: (state, action: PayloadAction<{ minerId: string; status: 'online' | 'offline' | 'error' }>) => {
      if (state.stats) {
        const miner = state.stats.miners.find(m => m.minerId === action.payload.minerId);
        if (miner) {
          miner.status = action.payload.status;
        }
      }
    },
    
    // Optimistic update: Mark miner as rebooting
    setMinerRebooting: (state, action: PayloadAction<string>) => {
      if (state.stats) {
        const miner = state.stats.miners.find(m => m.minerId === action.payload);
        if (miner) {
          miner.status = 'offline';
          miner.statusMessage = 'Rebooting...';
        }
      }
    },
  },
});

export const { 
  updateStats, 
  setConnectionStatus, 
  setError, 
  clearError,
  setMinerStatusOptimistic,
  setMinerRebooting
} = miningSlice.actions;

// Selectors
export const selectMiningStats = (state: { mining: MiningState }) => state.mining.stats;
export const selectIsConnected = (state: { mining: MiningState }) => state.mining.isConnected;
export const selectLastUpdate = (state: { mining: MiningState }) => state.mining.lastUpdate;
export const selectError = (state: { mining: MiningState }) => state.mining.error;
export const selectMiners = (state: { mining: MiningState }) => state.mining.stats?.miners || [];
export const selectTotalHashrate = (state: { mining: MiningState }) => state.mining.stats?.totalHashrate || 0;
export const selectActiveMiners = (state: { mining: MiningState }) => state.mining.stats?.activeMiners || 0;

export default miningSlice.reducer;
