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
import { 
  getMiners, 
  addMiner, 
  updateMiner, 
  deleteMiner,
  importMinersFromYAML,
  exportMinersToYAML,
  backupMinersToYAML,
  getEffectiveThresholds,
} from '../config/miners.config';
import { requireAdmin } from '../middleware/auth.middleware';
import { getDatabase } from '../services/database.service';
import * as alertRulesService from '../services/alert-rules.service';
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
  getAlertStats,
  cleanupDuplicateAlerts
} from '../services/alert.service';
import {
  rebootMiner,
  rebootMiners,
  getMinerPools,
  updateMinerPools,
  bulkUpdatePools,
} from '../services/miner-control.service';

const router = Router();

// Get configured thresholds (global defaults + per-miner overrides)
router.get('/mining/thresholds', cacheMiddleware(30), async (req, res, next) => {
  try {
    const { config } = require('../config/config');
    const globalThresholds = config.thresholds;
    
    // Get per-miner thresholds if minerIp is provided
    const { minerIp } = req.query;
    if (minerIp && typeof minerIp === 'string') {
      const miners = getMiners();
      const miner = miners.find(m => m.ip === minerIp);
      if (miner) {
        const effectiveThresholds = getEffectiveThresholds(miner);
        res.json({
          global: globalThresholds,
          miner: effectiveThresholds,
          minerIp,
        });
        return;
      }
    }
    
    // Return only global thresholds
    res.json({
      global: globalThresholds,
    });
  } catch (error) {
    next(error);
  }
});

// Get current mining stats (cached for 5 seconds, filtered by owner if not admin)
router.get('/mining/stats', cacheMiddleware(5), async (req, res, next) => {
  try {
    // Admin sees all miners, regular users see only their own
    const owner = req.user?.role === 'admin' ? undefined : req.user?.chatId;
    const stats = getMiningStats(owner);
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

// Cleanup invalid stats data
router.post('/mining/database/cleanup', requireAdmin, async (req, res, next) => {
  try {
    const { maxHashrate = 10000 } = req.body;
    const db = getDatabase();
    const deletedCount = db.cleanupInvalidStats(maxHashrate);
    
    res.json({ 
      success: true, 
      deletedRecords: deletedCount,
      message: `Cleaned up ${deletedCount} invalid stats records (hashrate > ${maxHashrate} TH/s)`
    });
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

// Transfer miner ownership (admin only)
router.post('/mining/miners/:minerId/transfer', requireAdmin, async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const { newOwner } = req.body;
    
    if (!newOwner) {
      return res.status(400).json({ error: 'newOwner (Telegram chat ID) is required' });
    }
    
    const db = getDatabase();
    const miner = db.getMinerByName(minerId) || db.getMinerByIp(minerId) || db.getMinerByAlias(minerId);
    
    if (!miner) {
      return res.status(404).json({ error: `Miner ${minerId} not found` });
    }
    
    const oldOwner = miner.owner;
    
    // Update ownership in database
    const updatedMiner = {
      ...miner,
      owner: newOwner,
    };
    
    db.upsertMiner(updatedMiner);
    
    logger.info(`Ownership transferred: ${miner.name} from ${oldOwner.substring(0, 4)}*** to ${newOwner.substring(0, 4)}***`, {
      minerId: miner.name,
      oldOwner,
      newOwner,
      adminChatId: req.user?.chatId,
    });
    
    res.json({ 
      success: true, 
      message: `Ownership of ${miner.name} transferred successfully`,
      miner: {
        ip: miner.ip,
        name: miner.name,
        model: miner.model,
        oldOwner,
        newOwner,
      }
    });
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

// Get miner pool configuration from hardware
router.get('/mining/miners/:minerId/pools', async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const result = await getMinerPools(minerId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get miner pool assignments from database
router.get('/mining/miners/:minerIp/pool-assignments', async (req, res, next) => {
  try {
    const { minerIp } = req.params;
    const db = getDatabase();
    const assignments = db.getMinerPools(minerIp);
    
    res.json({
      success: true,
      miner_ip: minerIp,
      pools: assignments,
    });
  } catch (error) {
    logger.error('Error getting miner pool assignments:', error);
    next(error);
  }
});

// Note: Individual pool assignment endpoints removed.
// Use PUT /mining/miners/:minerIp/pool-assignments or sync from hardware instead.

// Update all pool assignments for a miner in database
router.put('/mining/miners/:minerIp/pool-assignments', async (req, res, next) => {
  try {
    const { minerIp } = req.params;
    const { pools } = req.body;
    
    if (!pools || !Array.isArray(pools)) {
      return res.status(400).json({ error: 'pools array is required' });
    }
    
    // Validate pool format
    for (const pool of pools) {
      if (!pool.url || !pool.user) {
        return res.status(400).json({ error: 'Each pool must have url and user fields' });
      }
    }
    
    const db = getDatabase();
    
    // Set all pools at once
    const poolsData = pools.map((pool, index) => ({
      url: pool.url,
      user: pool.user,
      password: pool.password || '',
      priority: pool.priority !== undefined ? pool.priority : index
    }));
    
    db.setMinerPools(minerIp, poolsData);
    
    res.json({
      success: true,
      message: 'Pool assignments updated',
      miner_ip: minerIp,
      pools_assigned: poolsData.length,
    });
  } catch (error) {
    logger.error('Error updating pool assignments:', error);
    next(error);
  }
});

// Sync hardware pools to database
router.post('/mining/miners/:minerIp/pool-assignments/sync', async (req, res, next) => {
  try {
    const { minerIp } = req.params;
    
    // Get pools from hardware
    const hardwarePools = await getMinerPools(minerIp);
    
    if (!hardwarePools.success || !hardwarePools.pools || hardwarePools.pools.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No pools found on miner hardware',
      });
    }
    
    const db = getDatabase();
    
    // Prepare pools data for database
    const poolsData = hardwarePools.pools.map((hwPool: any, index: number) => ({
      url: hwPool.url.replace(/^stratum\+tcp:\/\//, ''), // Clean URL
      user: hwPool.user || '',
      password: hwPool.password || '',
      priority: index
    }));
    
    // Save pools to database
    db.setMinerPools(minerIp, poolsData);
    
    res.json({
      success: true,
      message: `Synced ${poolsData.length} pools from hardware to database`,
      miner_ip: minerIp,
      synced: poolsData.length,
      skipped: 0,
      total: hardwarePools.pools.length,
      pools: poolsData,
    });
  } catch (error) {
    logger.error('Error syncing hardware pools:', error);
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
router.post('/mining/alerts/webhook', async (req, res, next) => {
  try {
    await processAlertWebhook(req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get active alerts (cached for 3 seconds)
router.get('/mining/alerts/active', cacheMiddleware(3), async (req, res, next) => {
  try {
    const alerts = getActiveAlerts();
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

// Get alert history (cached for 10 seconds)
router.get('/mining/alerts/history', cacheMiddleware(10), async (req, res, next) => {
  try {
    const { limit = 100 } = req.query;
    const alerts = getAlertHistory(parseInt(limit as string, 10));
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

// Get alerts for specific miner (cached for 5 seconds)
router.get('/mining/alerts/miner/:minerId', cacheMiddleware(5), async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const alerts = getMinerAlerts(minerId);
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

// Get alert statistics
router.get('/mining/alerts/stats', async (req, res, next) => {
  try {
    const stats = getAlertStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Cleanup duplicate alerts from database
router.post('/mining/alerts/cleanup-duplicates', async (req, res, next) => {
  try {
    const result = cleanupDuplicateAlerts();
    res.json({
      success: true,
      message: `Cleaned up ${result.removed} duplicate alerts`,
      removed: result.removed
    });
  } catch (error) {
    next(error);
  }
});

// Create manual alert
router.post('/mining/alerts/manual', async (req, res, next) => {
  try {
    const { name, severity, summary, description, miner, minerIp, isFarmWide, recipients } = req.body;
    
    // Validation
    if (!name || !severity || !summary) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, severity, summary',
      });
    }
    
    if (!['critical', 'warning', 'info'].includes(severity)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid severity. Must be: critical, warning, or info',
      });
    }
    
    const { createManualAlert } = require('../services/alert.service');
    const alert = await createManualAlert({
      name,
      severity,
      summary,
      description: description || '',
      miner,
      minerIp,
      isFarmWide: isFarmWide || false,
      recipients,
    });
    
    res.json({
      success: true,
      alert,
      message: 'Manual alert created successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Resolve manual alert
router.post('/mining/alerts/:alertId/resolve', async (req, res, next) => {
  try {
    const { alertId } = req.params;
    const { resolveManualAlert } = require('../services/alert.service');
    const success = await resolveManualAlert(alertId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found or already resolved',
      });
    }
    
    res.json({
      success: true,
      message: 'Alert resolved successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ===== Prometheus Alert Rules API =====

// Get all Prometheus alert rules
router.get('/prometheus/rules', async (req, res, next) => {
  try {
    const { getPrometheusAlertRules } = require('../services/prometheus.service');
    const rules = await getPrometheusAlertRules();
    res.json(rules);
  } catch (error) {
    next(error);
  }
});

// Reload Prometheus configuration
router.post('/prometheus/reload', async (req, res, next) => {
  try {
    const { reloadPrometheusConfig } = require('../services/prometheus.service');
    const result = await reloadPrometheusConfig();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
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
    const { config } = require('../config/config');
    const internalToken = config.auth.internalMetricsToken;
    const requestToken = req.header('X-Internal-Token');

    if (internalToken) {
      if (requestToken !== internalToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    } else {
      if (config.env === 'production') {
        logger.error('INTERNAL_METRICS_TOKEN is required in production');
        return res.status(503).json({ error: 'INTERNAL_METRICS_TOKEN is required in production' });
      }
      logger.warn('WARNING: /api/internal/metrics is unauthenticated. Set INTERNAL_METRICS_TOKEN to secure this endpoint.');
    }

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

// ==================== YAML IMPORT/EXPORT ENDPOINTS ====================

/**
 * POST /api/mining/import-yaml
 * Import miners from YAML file to database
 * Admin only - requires authentication
 */
router.post('/mining/import-yaml', requireAdmin, async (req, res, next) => {
  try {
    logger.info('Starting miners YAML import...');
    const result = importMinersFromYAML();

    res.json({
      success: true,
      message: `Import complete: ${result.imported} imported, ${result.skipped} skipped`,
      ...result,
    });
  } catch (error) {
    logger.error('Error importing miners from YAML:', error);
    next(error);
  }
});

/**
 * GET /api/mining/export-yaml
 * Export current miners configuration as YAML
 * Admin only - returns YAML file
 * Optional query param: owner=chatId to export only specific user's miners
 */
router.get('/mining/export-yaml', requireAdmin, (req, res, next) => {
  try {
    const owner = req.query.owner as string | undefined;
    const yamlStr = exportMinersToYAML(owner);

    const filename = owner 
      ? `miners-${owner.substring(0, 8)}-config.yaml`
      : 'miners-config.yaml';

    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(yamlStr);
  } catch (error) {
    logger.error('Error exporting miners to YAML:', error);
    next(error);
  }
});

/**
 * POST /api/mining/backup-yaml
 * Backup current miners configuration to YAML file on server
 * Admin only - saves to configured path
 */
router.post('/mining/backup-yaml', requireAdmin, (req, res, next) => {
  try {
    const owner = req.body.owner as string | undefined;
    backupMinersToYAML(undefined, owner);

    res.json({
      success: true,
      message: 'Miners configuration backed up to YAML file',
    });
  } catch (error) {
    logger.error('Error backing up miners to YAML:', error);
    next(error);
  }
});

// ==================== ALERT RULES MANAGEMENT ENDPOINTS ====================

/**
 * GET /api/mining/alert-rules
 * Get all alert rules (with optional filters)
 */
router.get('/mining/alert-rules', async (req, res, next) => {
  try {
    const filters: any = {};

    if (req.query.enabled !== undefined) {
      filters.enabled = req.query.enabled === 'true';
    }
    if (req.query.severity) {
      filters.severity = req.query.severity;
    }
    if (req.query.component) {
      filters.component = req.query.component;
    }
    if (req.query.scope) {
      filters.scope = req.query.scope;
    }
    if (req.query.owner) {
      filters.owner = req.query.owner;
    }
    if (req.query.minerIp) {
      filters.minerIp = req.query.minerIp;
    }

    const rules = alertRulesService.getAllAlertRules(filters);
    res.json({ success: true, rules });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/mining/alert-rules/:id
 * Get single alert rule by ID
 */
router.get('/mining/alert-rules/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid rule ID' });
    }

    const rule = alertRulesService.getAlertRuleById(id);
    if (!rule) {
      return res.status(404).json({ success: false, error: 'Alert rule not found' });
    }

    res.json({ success: true, rule });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/mining/alert-rules
 * Create new alert rule
 */
router.post('/mining/alert-rules', async (req, res, next) => {
  try {
    const result = alertRulesService.createAlertRule(req.body);
    
    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/mining/alert-rules/:id
 * Update existing alert rule
 */
router.put('/mining/alert-rules/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid rule ID' });
    }

    const changedBy = req.body.changed_by;
    const result = alertRulesService.updateAlertRule(id, req.body, changedBy);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/mining/alert-rules/:id
 * Delete alert rule
 */
router.delete('/mining/alert-rules/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid rule ID' });
    }

    const changedBy = req.body.changed_by || req.query.changed_by as string;
    const result = alertRulesService.deleteAlertRule(id, changedBy);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/mining/alert-rules/:id/toggle
 * Enable or disable alert rule
 */
router.post('/mining/alert-rules/:id/toggle', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid rule ID' });
    }

    const { enabled, changed_by } = req.body;
    if (enabled === undefined) {
      return res.status(400).json({ success: false, error: 'enabled field is required' });
    }

    const result = alertRulesService.toggleAlertRule(id, enabled, changed_by);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/mining/alert-rules/:id/history
 * Get alert rule change history
 */
router.get('/mining/alert-rules/:id/history', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid rule ID' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const history = alertRulesService.getAlertRuleHistory(id, limit);

    res.json({ success: true, history });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/mining/alert-rules/regenerate
 * Regenerate Prometheus YAML from database and reload
 */
router.post('/mining/alert-rules/regenerate', async (req, res, next) => {
  try {
    const result = await alertRulesService.regeneratePrometheusYAML();
    
    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
