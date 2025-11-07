import { Router } from 'express';
import { logger } from '../utils/logger';
import { cacheMiddleware } from '../services/cache.service';
import { 
  getMiningStats, 
  getMinerStats,
  getHistoricalStats, 
  getDatabaseInfo, 
  backupDatabase,
  startMining, 
  stopMining, 
  restartMiner, 
  updateMinerConfig,
  updateMetricsFromScheduler 
} from '../services/mining.service';
import { getMiners, addMiner, updateMiner, deleteMiner } from '../config/miners.config';
import { 
  initTelegramBot, 
  testConnection, 
  getBotStatus, 
  sendMessage 
} from '../services/telegram.service';
import { 
  processAlertWebhook, 
  getActiveAlerts, 
  getAlertHistory, 
  getMinerAlerts,
  getAlertStats 
} from '../services/alert.service';
import {
  rebootMiner,
  rebootMiners,
  getMinerPools,
  updateMinerPools,
  bulkUpdatePools,
} from '../services/miner-control.service';

const router = Router();

// Get current mining stats (cached for 5 seconds)
router.get('/mining/stats', cacheMiddleware(5), async (req, res, next) => {
  try {
    const stats = getMiningStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Start mining
router.post('/mining/start', async (req, res, next) => {
  try {
    const result = await startMining(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Stop mining
router.post('/mining/stop', async (req, res, next) => {
  try {
    const result = await stopMining();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Restart a specific miner
router.post('/mining/restart/:minerId', async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const result = await restartMiner(minerId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Update miner configuration
router.put('/mining/config/:minerId', async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const result = await updateMinerConfig(minerId, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get historical stats
router.get('/mining/history', async (req, res, next) => {
  try {
    const { start, end, granularity = 'raw' } = req.query;
    
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end timestamps are required' });
    }
    
    const startTime = parseInt(start as string, 10);
    const endTime = parseInt(end as string, 10);
    const gran = granularity as 'raw' | 'hourly' | 'daily';
    
    const stats = getHistoricalStats(startTime, endTime, gran);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get database info
router.get('/mining/database/info', async (req, res, next) => {
  try {
    const info = getDatabaseInfo();
    res.json(info);
  } catch (error) {
    next(error);
  }
});

// Backup database
router.post('/mining/database/backup', async (req, res, next) => {
  try {
    const { path: backupPath } = req.body;
    
    if (!backupPath) {
      return res.status(400).json({ error: 'backup path is required' });
    }
    
    const result = backupDatabase(backupPath);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ===== Miner Management Endpoints =====

// Get all miners configuration
router.get('/mining/miners', async (req, res, next) => {
  try {
    // If system user (python-scheduler), return all miners
    // If regular user, return only their miners
    const owner = req.user?.isSystem ? undefined : req.user?.chatId;
    const miners = getMiners(owner, true);
    res.json({ miners });
  } catch (error) {
    next(error);
  }
});

// Add new miner
router.post('/mining/miners', async (req, res, next) => {
  try {
    const { name, ip, model, alias, username, password, api_port } = req.body;
    
    if (!ip || !model) {
      return res.status(400).json({ error: 'IP and model are required' });
    }
    
    // Get owner from authenticated user context
    const owner = req.user?.chatId || '';
    if (!owner || owner === 'system') {
      return res.status(400).json({ error: 'Owner (Telegram chat ID) is required. System users cannot add miners.' });
    }
    
    const newMiner = addMiner({ name, ip, model, alias, username, password, api_port }, owner);
    res.json({ success: true, miner: newMiner });
  } catch (error) {
    next(error);
  }
});

// Update miner
router.put('/mining/miners/:minerId', async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const updates = req.body;
    
    const updatedMiner = updateMiner(minerId, updates);
    
    if (!updatedMiner) {
      return res.status(404).json({ error: `Miner ${minerId} not found` });
    }
    
    res.json({ success: true, miner: updatedMiner });
  } catch (error) {
    next(error);
  }
});

// Delete miner
router.delete('/mining/miners/:minerId', async (req, res, next) => {
  try {
    const { minerId } = req.params;
    
    const deleted = deleteMiner(minerId);
    
    if (!deleted) {
      return res.status(404).json({ error: `Miner ${minerId} not found` });
    }
    
    res.json({ success: true, message: `Miner ${minerId} deleted` });
  } catch (error) {
    next(error);
  }
});


// ===== Miner Control APIs =====

// Reboot single miner
router.post('/mining/miners/:minerId/reboot', async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const result = await rebootMiner(minerId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Bulk reboot miners
router.post('/mining/miners/bulk/reboot', async (req, res, next) => {
  try {
    const { minerIds } = req.body;
    
    if (!minerIds || !Array.isArray(minerIds)) {
      return res.status(400).json({ error: 'minerIds array is required' });
    }
    
    const result = await rebootMiners(minerIds);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Reboot all miners
router.post('/mining/miners/reboot-all', async (req, res, next) => {
  try {
    const allMiners = getMiners();
    const minerIds = allMiners.map(m => m.name || m.ip);
    
    logger.info(`Reboot all requested: ${minerIds.length} miners`);
    const result = await rebootMiners(minerIds);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get miner pool configuration
router.get('/mining/miners/:minerId/pools', async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const result = await getMinerPools(minerId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Update miner pool configuration
router.put('/mining/miners/:minerId/pools', async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const { pools } = req.body;
    
    if (!pools || !Array.isArray(pools)) {
      return res.status(400).json({ error: 'pools array is required' });
    }
    
    const result = await updateMinerPools(minerId, pools);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Bulk update pools
router.post('/mining/miners/bulk/pools', async (req, res, next) => {
  try {
    const { minerIds, pools } = req.body;
    
    if (!minerIds || !Array.isArray(minerIds)) {
      return res.status(400).json({ error: 'minerIds array is required' });
    }
    
    if (!pools || !Array.isArray(pools)) {
      return res.status(400).json({ error: 'pools array is required' });
    }
    
    const result = await bulkUpdatePools(minerIds, pools);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ===== Telegram Bot APIs =====

// Initialize Telegram bot
router.post('/telegram/init', async (req, res, next) => {
  try {
    const { token, chatId } = req.body;
    
    if (!token || !chatId) {
      return res.status(400).json({ error: 'Token and chatId are required' });
    }
    
    initTelegramBot(token, chatId);
    res.json({ success: true, message: 'Telegram bot initialized' });
  } catch (error) {
    next(error);
  }
});

// Test Telegram connection
router.post('/telegram/test', async (req, res, next) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get Telegram bot status
router.get('/telegram/status', async (req, res, next) => {
  try {
    const status = getBotStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

// Send custom message via Telegram
router.post('/telegram/send', async (req, res, next) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    await sendMessage(message);
    res.json({ success: true, message: 'Message sent' });
  } catch (error) {
    next(error);
  }
});

// ===== Alert APIs =====

// Webhook endpoint for Alertmanager
router.post('/alerts/webhook', async (req, res, next) => {
  try {
    await processAlertWebhook(req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get active alerts (cached for 3 seconds)
router.get('/alerts/active', cacheMiddleware(3), async (req, res, next) => {
  try {
    const alerts = getActiveAlerts();
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

// Get alert history (cached for 10 seconds)
router.get('/alerts/history', cacheMiddleware(10), async (req, res, next) => {
  try {
    const { limit = 100 } = req.query;
    const alerts = getAlertHistory(parseInt(limit as string, 10));
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

// Get alerts for specific miner (cached for 5 seconds)
router.get('/alerts/miner/:minerId', cacheMiddleware(5), async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const alerts = getMinerAlerts(minerId);
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

// Get alert statistics
router.get('/alerts/stats', async (req, res, next) => {
  try {
    const stats = getAlertStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// ===== Miner Stats API =====

// Get detailed stats for specific miner
router.get('/miners/:minerId/stats', async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const stats = getMinerStats(minerId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// ===== Internal API (for python-scheduler) =====

// Receive metrics push from python-scheduler
router.post('/internal/metrics', async (req, res, next) => {
  try {
    const { miners, timestamp, collection_info } = req.body;
    
    if (!miners || !Array.isArray(miners)) {
      return res.status(400).json({ error: 'miners array is required' });
    }
    
    logger.info(`Received metrics push from scheduler: ${miners.length} miners`);
    
    await updateMetricsFromScheduler(miners, timestamp, collection_info);
    
    res.json({ 
      success: true, 
      message: `Updated metrics for ${miners.length} miners`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error processing metrics push:', error);
    next(error);
  }
});

export default router;
