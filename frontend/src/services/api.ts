import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface MiningStatsResponse {
  currentHashrate: number;
  activeMiners: number;
  totalMined: number;
  hashrateHistory: number[];
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
