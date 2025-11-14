/**
 * Pool API Routes
 * 
 * Endpoints for managing pool APIs and accounts
 */

import { Router } from 'express';
import { getDatabase } from '../services/database.service';
import { 
  encryptApiKey, 
  getPoolUserInfo, 
  getPoolRewards, 
  getPoolPayouts,
  getPoolWorkers 
} from '../services/pool.service';
import { logger } from '../utils/logger';

const router = Router();

// ==================== POOL API MANAGEMENT ====================

/**
 * GET /api/pool-apis
 * Get all configured pool APIs
 */
router.get('/pool-apis', async (req, res, next) => {
  try {
    const db = getDatabase();
    const poolApis = db.getAllPoolApis();
    res.json(poolApis);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/pool-apis
 * Add a new pool API
 */
router.post('/pool-apis', async (req, res, next) => {
  try {
    const { name, api_base_url } = req.body;
    
    if (!name || !api_base_url) {
      return res.status(400).json({ error: 'Name and API base URL are required' });
    }
    
    const db = getDatabase();
    const id = db.insertPoolApi({ name, api_base_url });
    
    res.status(201).json({ id, name, api_base_url });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/pool-apis/:id
 * Update a pool API
 */
router.put('/pool-apis/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, api_base_url } = req.body;
    
    if (!name || !api_base_url) {
      return res.status(400).json({ error: 'Name and API base URL are required' });
    }
    
    const db = getDatabase();
    db.updatePoolApi(id, { name, api_base_url });
    
    res.json({ id, name, api_base_url });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/pool-apis/:id
 * Delete a pool API
 */
router.delete('/pool-apis/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDatabase();
    db.deletePoolApi(id);
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==================== POOL ACCOUNT MANAGEMENT ====================

/**
 * GET /api/pool-accounts
 * Get all pool accounts
 */
router.get('/pool-accounts', async (req, res, next) => {
  try {
    const db = getDatabase();
    const accounts = db.getAllPoolAccounts();
    
    // Remove encrypted API keys from response
    const sanitized = accounts.map(account => ({
      id: account.id,
      pool_api_id: account.pool_api_id,
      pool_name: account.pool_name,
      account_name: account.account_name,
      // Don't send the encrypted API key to frontend
    }));
    
    res.json(sanitized);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/pool-accounts/:id
 * Get a specific pool account
 */
router.get('/pool-accounts/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDatabase();
    const account = db.getPoolAccountById(id);
    
    if (!account) {
      return res.status(404).json({ error: 'Pool account not found' });
    }
    
    // Remove encrypted API key from response
    const sanitized = {
      id: account.id,
      pool_api_id: account.pool_api_id,
      pool_name: account.pool_name,
      account_name: account.account_name,
    };
    
    res.json(sanitized);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/pool-accounts
 * Create a new pool account
 */
router.post('/pool-accounts', async (req, res, next) => {
  try {
    const { pool_api_id, account_name, api_key } = req.body;
    
    if (!pool_api_id || !account_name || !api_key) {
      return res.status(400).json({ 
        error: 'Pool API ID, account name, and API key are required' 
      });
    }
    
    // Encrypt the API key before storing
    const encryptedKey = encryptApiKey(api_key);
    
    const db = getDatabase();
    const id = db.insertPoolAccount({
      pool_api_id,
      account_name,
      api_key: encryptedKey,
    });
    
    logger.info(`Pool account created: ${account_name} (ID: ${id})`);
    
    res.status(201).json({ 
      id, 
      pool_api_id, 
      account_name,
      message: 'Pool account created successfully' 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/pool-accounts/:id
 * Update a pool account
 */
router.put('/pool-accounts/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { pool_api_id, account_name, api_key } = req.body;
    
    if (!pool_api_id || !account_name) {
      return res.status(400).json({ 
        error: 'Pool API ID and account name are required' 
      });
    }
    
    const db = getDatabase();
    
    // If API key is provided, encrypt it; otherwise keep the existing one
    let encryptedKey: string;
    if (api_key) {
      encryptedKey = encryptApiKey(api_key);
    } else {
      const existing = db.getPoolAccountById(id);
      if (!existing) {
        return res.status(404).json({ error: 'Pool account not found' });
      }
      encryptedKey = existing.api_key;
    }
    
    db.updatePoolAccount(id, {
      pool_api_id,
      account_name,
      api_key: encryptedKey,
    });
    
    logger.info(`Pool account updated: ${account_name} (ID: ${id})`);
    
    res.json({ 
      id, 
      pool_api_id, 
      account_name,
      message: 'Pool account updated successfully' 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/pool-accounts/:id
 * Delete a pool account
 */
router.delete('/pool-accounts/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDatabase();
    db.deletePoolAccount(id);
    
    logger.info(`Pool account deleted: ID ${id}`);
    
    res.json({ success: true, message: 'Pool account deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// ==================== POOL DATA PROXY ENDPOINTS ====================

/**
 * GET /api/pool-data/:accountId/info
 * Get user info from pool
 */
router.get('/pool-data/:accountId/info', async (req, res, next) => {
  try {
    const accountId = parseInt(req.params.accountId, 10);
    const result = await getPoolUserInfo(accountId);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/pool-data/:accountId/rewards
 * Get rewards from pool
 */
router.get('/pool-data/:accountId/rewards', async (req, res, next) => {
  try {
    const accountId = parseInt(req.params.accountId, 10);
    const coin = (req.query.coin as string) || 'btc';
    
    const result = await getPoolRewards(accountId, coin);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/pool-data/:accountId/payouts
 * Get payouts from pool
 */
router.get('/pool-data/:accountId/payouts', async (req, res, next) => {
  try {
    const accountId = parseInt(req.params.accountId, 10);
    const coin = (req.query.coin as string) || 'btc';
    
    const result = await getPoolPayouts(accountId, coin);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/pool-data/:accountId/workers
 * Get workers from pool
 */
router.get('/pool-data/:accountId/workers', async (req, res, next) => {
  try {
    const accountId = parseInt(req.params.accountId, 10);
    const coin = (req.query.coin as string) || 'btc';
    
    const result = await getPoolWorkers(accountId, coin);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;
