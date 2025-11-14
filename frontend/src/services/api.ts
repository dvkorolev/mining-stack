import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to inject Telegram Chat ID header
api.interceptors.request.use((config) => {
  // Try to get user Chat ID first, fallback to admin Chat ID
  const userChatId = localStorage.getItem('userChatId');
  const adminChatId = localStorage.getItem('adminChatId');
  const chatId = userChatId || adminChatId;
  
  if (chatId) {
    config.headers['X-Telegram-Chat-ID'] = chatId;
  }
  
  return config;
}, (error) => {
  return Promise.reject(error);
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
  algorithm?: 'sha256' | 'scrypt';
  status: 'online' | 'offline' | 'error';
  statusMessage?: string;
  lastSeen: string;
  currentHashrate: number; // Always in TH/s
  averageHashrate: number; // Always in TH/s
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
  totalHashrate: number; // Combined total
  totalHashrateSha256: number; // SHA256 total in TH/s
  totalHashrateScrypt: number; // SCRYPT total in TH/s
  averageHashrate24h: number; // Combined average
  averageHashrate24hSha256: number; // SHA256 24h average
  averageHashrate24hScrypt: number; // SCRYPT 24h average
  activeMiners: number;
  activeMinersSha256: number; // Active SHA256 miners
  activeMinersScrypt: number; // Active SCRYPT miners
  totalMined: number;
  miners: MinerStats[];
  timestamp: number;
  statsHistory: {
    timestamp: number;
    hashrate: number;
    hashrateSha256: number;
    hashrateScrypt: number;
  }[];
  // Pre-calculated aggregate statistics from backend
  aggregates?: {
    avgEfficiency: number; // GH/W (SHA256 only)
    totalPower: number; // W
    avgTemperature: number; // °C
    rejectionRate: number; // %
    maxHashrate: number; // TH/s (from last 24h, SHA256 only)
    minHashrate: number; // TH/s (from last 24h, SHA256 only)
    maxHashrateScrypt: number; // TH/s (from last 24h, SCRYPT only)
    minHashrateScrypt: number; // TH/s (from last 24h, SCRYPT only)
    uptimePercent: number; // %
  };
}

// ==================== THRESHOLDS API ====================

export interface ThresholdsConfig {
  temperature: {
    warning: number;
    critical: number;
    shutdown: number;
  };
  hashrate: {
    expected?: number;
    warningPercent: number;
    criticalPercent: number;
  };
  power: {
    expected?: number;
    warningPercent: number;
  };
  rejectionRate: {
    warning: number;
    critical: number;
  };
  fanSpeed: {
    warning: number;
    critical: number;
  };
}

export interface ThresholdsResponse {
  global: ThresholdsConfig;
  miner?: ThresholdsConfig;
  minerIp?: string;
}

export const getThresholds = async (minerIp?: string): Promise<ThresholdsResponse> => {
  try {
    const params = minerIp ? `?minerIp=${minerIp}` : '';
    const response = await api.get(`/mining/thresholds${params}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching thresholds:', error);
    throw error;
  }
};

// ==================== MINING STATS API ====================

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

// Reboot all miners
export const rebootAllMiners = async () => {
  try {
    const response = await api.post('/mining/miners/reboot-all');
    return response.data;
  } catch (error) {
    console.error('Error rebooting all miners:', error);
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

// ==================== ALERT RULES API ====================

export interface AlertRule {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  rule_group: string;
  severity: 'critical' | 'warning' | 'info';
  component: 'miner' | 'network' | 'farm' | 'system';
  expr: string;
  for_duration: string;
  summary_template: string;
  description_template?: string;
  scope: 'global' | 'per_miner' | 'per_owner';
  target_miner_ip?: string;
  target_owner?: string;
  enabled: number;
  is_system: number;
  created_by?: string;
  created_at?: number;
  updated_at?: number;
}

export interface AlertRuleFilters {
  enabled?: boolean;
  severity?: 'critical' | 'warning' | 'info';
  component?: 'miner' | 'network' | 'farm' | 'system';
  scope?: 'global' | 'per_miner' | 'per_owner';
  owner?: string;
  minerIp?: string;
}

export interface CreateAlertRuleParams {
  name: string;
  display_name: string;
  description?: string;
  rule_group: string;
  severity: 'critical' | 'warning' | 'info';
  component: 'miner' | 'network' | 'farm' | 'system';
  expr: string;
  for_duration: string;
  summary_template: string;
  description_template?: string;
  scope?: 'global' | 'per_miner' | 'per_owner';
  target_miner_ip?: string;
  target_owner?: string;
  enabled?: boolean;
  created_by?: string;
}

export interface UpdateAlertRuleParams {
  display_name?: string;
  description?: string;
  rule_group?: string;
  severity?: 'critical' | 'warning' | 'info';
  component?: 'miner' | 'network' | 'farm' | 'system';
  expr?: string;
  for_duration?: string;
  summary_template?: string;
  description_template?: string;
  scope?: 'global' | 'per_miner' | 'per_owner';
  target_miner_ip?: string;
  target_owner?: string;
  enabled?: boolean;
  changed_by?: string;
}

// Get all alert rules
export const getAlertRules = async (filters?: AlertRuleFilters) => {
  try {
    const params = new URLSearchParams();
    if (filters?.enabled !== undefined) params.append('enabled', String(filters.enabled));
    if (filters?.severity) params.append('severity', filters.severity);
    if (filters?.component) params.append('component', filters.component);
    if (filters?.scope) params.append('scope', filters.scope);
    if (filters?.owner) params.append('owner', filters.owner);
    if (filters?.minerIp) params.append('minerIp', filters.minerIp);
    
    const response = await api.get(`/mining/alert-rules?${params.toString()}`);
    return response.data;
  } catch (error) {
    console.error('Error getting alert rules:', error);
    throw error;
  }
};

// Get single alert rule
export const getAlertRule = async (id: number) => {
  try {
    const response = await api.get(`/mining/alert-rules/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error getting alert rule:', error);
    throw error;
  }
};

// Create alert rule
export const createAlertRule = async (params: CreateAlertRuleParams) => {
  try {
    const response = await api.post('/mining/alert-rules', params);
    return response.data;
  } catch (error) {
    console.error('Error creating alert rule:', error);
    throw error;
  }
};

// Update alert rule
export const updateAlertRule = async (id: number, params: UpdateAlertRuleParams) => {
  try {
    const response = await api.put(`/mining/alert-rules/${id}`, params);
    return response.data;
  } catch (error) {
    console.error('Error updating alert rule:', error);
    throw error;
  }
};

// Delete alert rule
export const deleteAlertRule = async (id: number, changedBy?: string) => {
  try {
    const response = await api.delete(`/mining/alert-rules/${id}`, {
      params: { changed_by: changedBy }
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting alert rule:', error);
    throw error;
  }
};

// Toggle alert rule
export const toggleAlertRule = async (id: number, enabled: boolean, changedBy?: string) => {
  try {
    const response = await api.post(`/mining/alert-rules/${id}/toggle`, {
      enabled,
      changed_by: changedBy
    });
    return response.data;
  } catch (error) {
    console.error('Error toggling alert rule:', error);
    throw error;
  }
};

// Get alert rule history
export const getAlertRuleHistory = async (id: number, limit?: number) => {
  try {
    const params = limit ? `?limit=${limit}` : '';
    const response = await api.get(`/mining/alert-rules/${id}/history${params}`);
    return response.data;
  } catch (error) {
    console.error('Error getting alert rule history:', error);
    throw error;
  }
};

// Regenerate Prometheus YAML
export const regeneratePrometheusYAML = async () => {
  try {
    const response = await api.post('/mining/alert-rules/regenerate');
    return response.data;
  } catch (error) {
    console.error('Error regenerating Prometheus YAML:', error);
    throw error;
  }
};

// ==================== POOL API MONITORING ====================

export interface PoolApi {
  id: number;
  name: string;
  api_base_url: string;
}

export interface PoolAccount {
  id: number;
  pool_api_id: number;
  pool_name: string;
  account_name: string;
  usernames?: string; // Comma-separated list of pool usernames for matching
  coin?: string; // btc, ltc, etc.
  notes?: string; // User notes
  // api_key is never sent to frontend
}

export interface PoolUserInfo {
  username?: string;
  balance?: number;
  totalPaid?: number;
  minPayout?: number;
  payoutAddress?: string;
  coin?: string;
  [key: string]: any;
}

export interface PoolReward {
  timestamp: number;
  datetime?: string;
  income: number;
  hashrate?: number;
  rewardType?: string;
  coin?: string;
  [key: string]: any;
}

export interface PoolPayout {
  timestamp: number;
  datetime?: string;
  amount: number;
  txid?: string;
  coin?: string;
  [key: string]: any;
}

// Get all pool APIs
export const getPoolApis = async (): Promise<PoolApi[]> => {
  try {
    const response = await api.get('/pool-apis');
    return response.data;
  } catch (error) {
    console.error('Error fetching pool APIs:', error);
    throw error;
  }
};

// Get all pool accounts
export const getPoolAccounts = async (): Promise<PoolAccount[]> => {
  try {
    const response = await api.get('/pool-accounts');
    return response.data;
  } catch (error) {
    console.error('Error fetching pool accounts:', error);
    throw error;
  }
};

// Create pool account
export const createPoolAccount = async (account: {
  pool_api_id: number;
  account_name: string;
  api_key: string;
}): Promise<{ id: number; pool_api_id: number; account_name: string; message: string }> => {
  try {
    const response = await api.post('/pool-accounts', account);
    return response.data;
  } catch (error) {
    console.error('Error creating pool account:', error);
    throw error;
  }
};

// Update pool account
export const updatePoolAccount = async (
  id: number,
  account: {
    pool_api_id: number;
    account_name: string;
    api_key?: string; // Optional - only if changing
  }
): Promise<{ id: number; pool_api_id: number; account_name: string; message: string }> => {
  try {
    const response = await api.put(`/pool-accounts/${id}`, account);
    return response.data;
  } catch (error) {
    console.error('Error updating pool account:', error);
    throw error;
  }
};

// Delete pool account
export const deletePoolAccount = async (id: number): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await api.delete(`/pool-accounts/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting pool account:', error);
    throw error;
  }
};

// Get pool user info
export const getPoolUserInfo = async (accountId: number): Promise<PoolUserInfo> => {
  try {
    const response = await api.get(`/pool-data/${accountId}/info`);
    return response.data;
  } catch (error) {
    console.error('Error fetching pool user info:', error);
    throw error;
  }
};

// Get pool rewards
export const getPoolRewards = async (accountId: number, coin: string = 'btc'): Promise<PoolReward[]> => {
  try {
    const response = await api.get(`/pool-data/${accountId}/rewards`, {
      params: { coin },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching pool rewards:', error);
    throw error;
  }
};

// Get pool payouts
export const getPoolPayouts = async (accountId: number, coin: string = 'btc'): Promise<PoolPayout[]> => {
  try {
    const response = await api.get(`/pool-data/${accountId}/payouts`, {
      params: { coin },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching pool payouts:', error);
    throw error;
  }
};

export default api;
