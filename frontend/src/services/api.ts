import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface MinerError {
  code: string;
  message: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: number;
  details?: Record<string, any>;
}

export interface MinerStats {
  minerId: string;
  name: string;
  model: string;
  ip: string;
  status: 'online' | 'offline' | 'error';
  statusMessage?: string;
  lastSeen: string;
  currentHashrate: number;
  averageHashrate: number;
  shares: {
    accepted: number;
    rejected: number;
  };
  hardware: {
    temperature: number;
    fanSpeed: number;
    powerUsage: number;
  };
  uptime: number;
  errors: MinerError[];
  errorCount: number;
  lastError?: MinerError;
}

export interface MiningStatsResponse {
  totalHashrate: number;
  averageHashrate24h: number;
  activeMiners: number;
  totalMined: number;
  miners: MinerStats[];
  timestamp: number;
  statsHistory: {
    timestamp: number;
    hashrate: number;
  }[];
}

export const fetchMiningStats = async (): Promise<MiningStatsResponse> => {
  try {
    const response = await api.get('/mining/stats');
    return response.data;
  } catch (error) {
    console.error('Error fetching mining stats:', error);
    throw error;
  }
};

export const restartMiner = async (minerId: string): Promise<void> => {
  try {
    await api.post(`/mining/restart/${minerId}`);
  } catch (error) {
    console.error(`Error restarting miner ${minerId}:`, error);
    throw error;
  }
};

export const updateMinerConfig = async (minerId: string, config: any): Promise<void> => {
  try {
    await api.put(`/mining/config/${minerId}`, config);
  } catch (error) {
    console.error(`Error updating config for miner ${minerId}:`, error);
    throw error;
  }
};

// ===== Miner Management APIs =====

export const fetchMiners = async () => {
  try {
    const response = await api.get('/mining/miners');
    return response.data;
  } catch (error) {
    console.error('Error fetching miners:', error);
    throw error;
  }
};

export const addMiner = async (miner: {
  name?: string;
  ip: string;
  model: string;
  alias?: string;
  owner?: string;
}) => {
  try {
    const response = await api.post('/mining/miners', miner);
    return response.data;
  } catch (error) {
    console.error('Error adding miner:', error);
    throw error;
  }
};

export const updateMiner = async (minerId: string, updates: any) => {
  try {
    const response = await api.put(`/mining/miners/${minerId}`, updates);
    return response.data;
  } catch (error) {
    console.error('Error updating miner:', error);
    throw error;
  }
};

export const deleteMiner = async (minerId: string) => {
  try {
    const response = await api.delete(`/mining/miners/${minerId}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting miner:', error);
    throw error;
  }
};

export const discoverMiners = async () => {
  try {
    const response = await api.post('/mining/discover');
    return response.data;
  } catch (error) {
    console.error('Error discovering miners:', error);
    throw error;
  }
};

// Reboot single miner
export const rebootMiner = async (minerId: string) => {
  try {
    const response = await api.post(`/mining/miners/${minerId}/reboot`);
    return response.data;
  } catch (error) {
    console.error('Error rebooting miner:', error);
    throw error;
  }
};

// Bulk reboot miners
export const bulkRebootMiners = async (minerIds: string[]) => {
  try {
    const response = await api.post('/mining/miners/bulk/reboot', { minerIds });
    return response.data;
  } catch (error) {
    console.error('Error rebooting miners:', error);
    throw error;
  }
};

// Get miner pools
export const getMinerPools = async (minerId: string) => {
  try {
    const response = await api.get(`/mining/miners/${minerId}/pools`);
    return response.data;
  } catch (error) {
    console.error('Error getting miner pools:', error);
    throw error;
  }
};

// Update miner pools
export const updateMinerPools = async (minerId: string, pools: any[]) => {
  try {
    const response = await api.put(`/mining/miners/${minerId}/pools`, { pools });
    return response.data;
  } catch (error) {
    console.error('Error updating miner pools:', error);
    throw error;
  }
};

// Bulk update pools
export const bulkUpdatePools = async (minerIds: string[], pools: any[]) => {
  try {
    const response = await api.post('/mining/miners/bulk/pools', { minerIds, pools });
    return response.data;
  } catch (error) {
    console.error('Error bulk updating pools:', error);
    throw error;
  }
};

export default api;
