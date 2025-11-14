// backend/src/routes/pools.routes.ts
import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  loadPoolsConfig,
  savePoolsConfig,
  validatePoolsConfig,
  addPool,
  updatePool,
  deletePool,
  triggerPoolCollection,
  checkPoolUsage,
  importPoolsFromYAML,
  exportPoolsToYAML,
  backupPoolsToYAML,
  PoolConfig,
  PoolsConfiguration,
} from '../services/pools-config.service';

const router = Router();

/**
 * GET /api/pools/config
 * Get current pools configuration
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    const config = loadPoolsConfig();
    res.json({
      success: true,
      config,
    });
  } catch (error) {
    logger.error('Error loading pools config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load pools configuration',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/pools/config
 * Update entire pools configuration
 */
router.post('/config', async (req: Request, res: Response) => {
  try {
    const config: PoolsConfiguration = req.body;

    // Validate configuration
    validatePoolsConfig(config);

    // Save configuration (with file locking)
    await savePoolsConfig(config);

    // Trigger pool collection to apply changes
    const collectionResult = await triggerPoolCollection();

    res.json({
      success: true,
      message: 'Pools configuration updated successfully',
      config,
      collection: collectionResult,
    });
  } catch (error) {
    logger.error('Error saving pools config:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to save pools configuration',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/pools
 * Get list of pools
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const config = loadPoolsConfig();
    res.json({
      success: true,
      pools: config.pools,
      count: config.pools.length,
    });
  } catch (error) {
    logger.error('Error loading pools:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load pools',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/pools
 * Add a new pool
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const pool: PoolConfig = req.body;

    // Validate required fields
    if (!pool.url || !pool.name || !pool.algorithm || !pool.priority) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: url, name, algorithm, priority',
      });
    }

    const config = await addPool(pool);

    // Trigger pool collection
    const collectionResult = await triggerPoolCollection();

    res.status(201).json({
      success: true,
      message: 'Pool added successfully',
      pool,
      config,
      collection: collectionResult,
    });
  } catch (error) {
    logger.error('Error adding pool:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to add pool',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/pools/:url
 * Update a pool (URL is encoded)
 */
router.put('/:url', async (req: Request, res: Response) => {
  try {
    const oldUrl = decodeURIComponent(req.params.url);
    const updatedPool: PoolConfig = req.body;

    // Validate required fields
    if (!updatedPool.url || !updatedPool.name || !updatedPool.algorithm || !updatedPool.priority) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: url, name, algorithm, priority',
      });
    }

    const config = await updatePool(oldUrl, updatedPool);

    // Trigger pool collection
    const collectionResult = await triggerPoolCollection();

    res.json({
      success: true,
      message: 'Pool updated successfully',
      pool: updatedPool,
      config,
      collection: collectionResult,
    });
  } catch (error) {
    logger.error('Error updating pool:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to update pool',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/pools/:url/usage
 * Check if a pool is in use by miners
 */
router.get('/:url/usage', (req: Request, res: Response) => {
  try {
    const url = decodeURIComponent(req.params.url);
    const usage = checkPoolUsage(url);

    res.json({
      success: true,
      ...usage,
    });
  } catch (error) {
    logger.error('Error checking pool usage:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check pool usage',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/pools/:url
 * Delete a pool (URL is encoded)
 */
router.delete('/:url', async (req: Request, res: Response) => {
  try {
    const url = decodeURIComponent(req.params.url);

    const config = await deletePool(url);

    // Trigger pool collection
    const collectionResult = await triggerPoolCollection();

    res.json({
      success: true,
      message: 'Pool deleted successfully',
      config,
      collection: collectionResult,
    });
  } catch (error) {
    logger.error('Error deleting pool:', error);
    
    if (error instanceof Error && error.message.includes('currently in use')) {
      // Pool is in use - return 409 Conflict
      res.status(409).json({
        success: false,
        message: error.message,
        error: error.message,
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to delete pool',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
});

/**
 * POST /api/pools/test/:url
 * Test connection to a specific pool
 */
router.post('/test/:url', async (req: Request, res: Response) => {
  try {
    const url = decodeURIComponent(req.params.url);
    const [hostname, portStr] = url.split(':');
    const port = parseInt(portStr, 10);

    if (!hostname || isNaN(port)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pool URL format. Expected hostname:port',
      });
    }

    // Test connection using Node.js net module
    const net = require('net');
    const startTime = Date.now();

    const socket = new net.Socket();
    socket.setTimeout(5000);

    socket.connect(port, hostname, () => {
      const duration = Date.now() - startTime;
      socket.destroy();

      res.json({
        success: true,
        message: 'Pool is reachable',
        url,
        hostname,
        port,
        duration_ms: duration,
        status: 'online',
      });
    });

    socket.on('error', (error: Error) => {
      socket.destroy();
      res.json({
        success: false,
        message: 'Pool is not reachable',
        url,
        hostname,
        port,
        status: 'offline',
        error: error.message,
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      res.json({
        success: false,
        message: 'Connection timeout',
        url,
        hostname,
        port,
        status: 'timeout',
      });
    });
  } catch (error) {
    logger.error('Error testing pool:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test pool',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/pools/collect
 * Trigger immediate pool collection
 */
router.post('/collect', async (req: Request, res: Response) => {
  try {
    const result = await triggerPoolCollection();

    res.json(result);
  } catch (error) {
    logger.error('Error triggering pool collection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger pool collection',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/pools/sync-from-miners
 * Sync pool configuration from all miners
 * Returns the actual pools each miner is using
 */
router.post('/sync-from-miners', async (req: Request, res: Response) => {
  try {
    const { syncPoolsFromMiners } = require('../services/pools-config.service');
    const result = await syncPoolsFromMiners();

    res.json(result);
  } catch (error) {
    logger.error('Error syncing pools from miners:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync pools from miners',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ==================== YAML IMPORT/EXPORT ENDPOINTS ====================

/**
 * POST /api/pools/import-yaml
 * Import pools from YAML file to database
 * Admin only - requires authentication
 */
router.post('/import-yaml', async (req: Request, res: Response) => {
  try {
    logger.info('Starting YAML import...');
    const result = importPoolsFromYAML();

    res.json({
      success: true,
      message: `Import complete: ${result.imported} imported, ${result.skipped} skipped`,
      ...result,
    });
  } catch (error) {
    logger.error('Error importing from YAML:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to import from YAML',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/pools/export-yaml
 * Export current pools configuration as YAML
 * Admin only - returns YAML file
 */
router.get('/export-yaml', (req: Request, res: Response) => {
  try {
    const yamlStr = exportPoolsToYAML();

    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', 'attachment; filename="pools-config.yaml"');
    res.send(yamlStr);
  } catch (error) {
    logger.error('Error exporting to YAML:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export to YAML',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/pools/backup-yaml
 * Backup current pools configuration to YAML file on server
 * Admin only - saves to configured path
 */
router.post('/backup-yaml', (req: Request, res: Response) => {
  try {
    backupPoolsToYAML();

    res.json({
      success: true,
      message: 'Pools configuration backed up to YAML file',
    });
  } catch (error) {
    logger.error('Error backing up to YAML:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to backup to YAML',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
