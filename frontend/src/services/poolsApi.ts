// frontend/src/services/poolsApi.ts
import api from './api';

export interface PoolConfig {
  url: string;
  name: string;
  algorithm: 'sha256' | 'scrypt' | 'multi';
  priority: 'high' | 'medium' | 'low';
}

export interface PoolsConfiguration {
  pools: PoolConfig[];
  config: {
    test_interval: number;
    enable_ping: boolean;
    connection_timeout: number;
    dns_timeout: number;
  };
}

export interface PoolTestResult {
  success: boolean;
  message: string;
  url: string;
  hostname: string;
  port: number;
  duration_ms?: number;
  status: 'online' | 'offline' | 'timeout';
  error?: string;
}

/**
 * Get pools configuration
 */
export const getPoolsConfig = async (): Promise<PoolsConfiguration> => {
  const response = await api.get('/pools/config');
  return response.data.config;
};

/**
 * Update pools configuration
 */
export const updatePoolsConfig = async (config: PoolsConfiguration): Promise<PoolsConfiguration> => {
  const response = await api.post('/pools/config', config);
  return response.data.config;
};

/**
 * Get list of pools
 */
export const getPools = async (): Promise<PoolConfig[]> => {
  const response = await api.get('/pools');
  return response.data.pools;
};

/**
 * Add a new pool
 */
export const addPool = async (pool: PoolConfig): Promise<PoolConfig> => {
  const response = await api.post('/pools', pool);
  return response.data.pool;
};

/**
 * Update a pool
 */
export const updatePool = async (oldUrl: string, updatedPool: PoolConfig): Promise<PoolConfig> => {
  const encodedUrl = encodeURIComponent(oldUrl);
  const response = await api.put(`/pools/${encodedUrl}`, updatedPool);
  return response.data.pool;
};

/**
 * Delete a pool
 */
export const deletePool = async (url: string): Promise<void> => {
  const encodedUrl = encodeURIComponent(url);
  await api.delete(`/pools/${encodedUrl}`);
};

/**
 * Test connection to a pool
 */
export const testPool = async (url: string): Promise<PoolTestResult> => {
  const encodedUrl = encodeURIComponent(url);
  const response = await api.post(`/pools/test/${encodedUrl}`);
  return response.data;
};

/**
 * Trigger pool collection
 */
export const triggerPoolCollection = async (): Promise<{ success: boolean; message: string }> => {
  const response = await api.post('/pools/collect');
  return response.data;
};
