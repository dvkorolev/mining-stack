/**
 * Pool Service
 * 
 * Handles mining pool API integration and data fetching
 * Features:
 * - Secure API key encryption/decryption
 * - Pool data fetching (user info, rewards, payouts)
 * - Support for multiple pool APIs (EMCD, etc.)
 */

import crypto from 'crypto';
import axios from 'axios';
import { logger } from '../utils/logger';
import { getDatabase } from './database.service';

// Encryption configuration
const ENCRYPTION_KEY = process.env.POOL_API_ENCRYPTION_KEY || 'default-key-change-in-production-32b';
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Encrypt API key for secure storage
 */
export const encryptApiKey = (apiKey: string): string => {
  try {
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return IV + encrypted data
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    logger.error('Error encrypting API key:', error);
    throw new Error('Failed to encrypt API key');
  }
};

/**
 * Decrypt API key for use
 */
export const decryptApiKey = (encryptedKey: string): string => {
  try {
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
    const parts = encryptedKey.split(':');
    
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted key format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    logger.error('Error decrypting API key:', error);
    throw new Error('Failed to decrypt API key');
  }
};

/**
 * Pool API interfaces
 */
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

export interface PoolDataResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Fetch data from EMCD pool API
 */
const fetchEMCDData = async (endpoint: string, apiKey: string): Promise<any> => {
  const baseUrl = 'https://api.emcd.io/v2';
  const url = `${baseUrl}/${endpoint}/${apiKey}`;
  
  try {
    logger.info(`Fetching EMCD data: ${endpoint}`);
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MiningStack/1.0',
      },
    });
    
    return response.data;
  } catch (error: any) {
    logger.error(`Error fetching EMCD data from ${endpoint}:`, error.message);
    throw new Error(`Failed to fetch data from EMCD: ${error.message}`);
  }
};

/**
 * Get user info from pool
 */
export const getPoolUserInfo = async (accountId: number): Promise<PoolDataResponse> => {
  try {
    const db = getDatabase();
    const account = db.getPoolAccountById(accountId);
    
    if (!account) {
      return { success: false, error: 'Pool account not found' };
    }
    
    // Decrypt API key
    const apiKey = decryptApiKey(account.api_key);
    
    // Currently only EMCD is supported
    // In the future, we can add a switch based on account.pool_name
    const data = await fetchEMCDData('info', apiKey);
    
    return { success: true, data };
  } catch (error: any) {
    logger.error(`Error getting pool user info for account ${accountId}:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Get rewards from pool
 */
export const getPoolRewards = async (accountId: number, coin: string = 'btc'): Promise<PoolDataResponse> => {
  try {
    const db = getDatabase();
    const account = db.getPoolAccountById(accountId);
    
    if (!account) {
      return { success: false, error: 'Pool account not found' };
    }
    
    // Decrypt API key
    const apiKey = decryptApiKey(account.api_key);
    
    // Fetch rewards for the specified coin
    const data = await fetchEMCDData(`${coin}/income`, apiKey);
    
    return { success: true, data };
  } catch (error: any) {
    logger.error(`Error getting pool rewards for account ${accountId}:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Get payouts from pool
 */
export const getPoolPayouts = async (accountId: number, coin: string = 'btc'): Promise<PoolDataResponse> => {
  try {
    const db = getDatabase();
    const account = db.getPoolAccountById(accountId);
    
    if (!account) {
      return { success: false, error: 'Pool account not found' };
    }
    
    // Decrypt API key
    const apiKey = decryptApiKey(account.api_key);
    
    // Fetch payouts for the specified coin
    const data = await fetchEMCDData(`${coin}/payouts`, apiKey);
    
    return { success: true, data };
  } catch (error: any) {
    logger.error(`Error getting pool payouts for account ${accountId}:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Get workers from pool
 */
export const getPoolWorkers = async (accountId: number, coin: string = 'btc'): Promise<PoolDataResponse> => {
  try {
    const db = getDatabase();
    const account = db.getPoolAccountById(accountId);
    
    if (!account) {
      return { success: false, error: 'Pool account not found' };
    }
    
    // Decrypt API key
    const apiKey = decryptApiKey(account.api_key);
    
    // Fetch workers for the specified coin
    const data = await fetchEMCDData(`${coin}/workers`, apiKey);
    
    return { success: true, data };
  } catch (error: any) {
    logger.error(`Error getting pool workers for account ${accountId}:`, error);
    return { success: false, error: error.message };
  }
};
