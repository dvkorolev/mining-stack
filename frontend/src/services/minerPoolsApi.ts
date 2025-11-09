// frontend/src/services/minerPoolsApi.ts
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export interface MinerPoolAssignment {
  pool_id: number;
  pool_name: string;
  pool_url: string;
  pool_priority: number;
  pool_user?: string;
  pool_password?: string;
  assigned_at: string;
}

export interface PoolAssignmentRequest {
  pool_id: number;
  priority: number;
  user?: string;
  password?: string;
}

/**
 * Get pool assignments for a miner from database
 */
export const getMinerPoolAssignments = async (minerIp: string): Promise<MinerPoolAssignment[]> => {
  const response = await axios.get(`${API_BASE_URL}/mining/miners/${minerIp}/pool-assignments`);
  return response.data.pools || [];
};

/**
 * Assign a pool to a miner in database
 */
export const assignPoolToMiner = async (
  minerIp: string,
  assignment: PoolAssignmentRequest
): Promise<void> => {
  await axios.post(`${API_BASE_URL}/mining/miners/${minerIp}/pool-assignments`, assignment);
};

/**
 * Remove a pool assignment from a miner in database
 */
export const removePoolFromMiner = async (minerIp: string, poolId: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/mining/miners/${minerIp}/pool-assignments/${poolId}`);
};

/**
 * Update all pool assignments for a miner in database
 */
export const updateMinerPoolAssignments = async (
  minerIp: string,
  pools: PoolAssignmentRequest[]
): Promise<void> => {
  await axios.put(`${API_BASE_URL}/mining/miners/${minerIp}/pool-assignments`, { pools });
};

/**
 * Get pool configuration from miner hardware (actual running config)
 */
export const getMinerHardwarePools = async (minerId: string): Promise<any> => {
  const response = await axios.get(`${API_BASE_URL}/mining/miners/${minerId}/pools`);
  return response.data;
};

/**
 * Update pool configuration on miner hardware
 */
export const updateMinerHardwarePools = async (minerId: string, pools: any[]): Promise<any> => {
  const response = await axios.put(`${API_BASE_URL}/mining/miners/${minerId}/pools`, { pools });
  return response.data;
};
