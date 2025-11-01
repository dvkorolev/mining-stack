import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface MinerStats {
  minerId: string;
  name: string;
  model: string;
  ip: string;
  status: 'online' | 'offline' | 'error';
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
  errors: string[];
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
    const response = await api.get<MiningStatsResponse>('/mining/stats');
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

export default api;
