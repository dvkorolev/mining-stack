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
  PoolConfig,
  PoolsConfiguration,
  FileLockTimeout,
  FileLockError,
} from '../services/pools-config.service';

const router = Router();

/**
 * Helper function to handle lock errors with appropriate HTTP status codes
 */
function handleLockError(error: unknown, res: Response): void {
  if (error instanceof FileLockTimeout) {
    // 423 Locked - Resource is locked
    res.status(423).json({
      success: false,
      message: 'Configuration file is locked by another process',
      error: error.message,
      code: 'FILE_LOCKED',
    });
  } else if (error instanceof FileLockError) {
    // 409 Conflict - Unable to acquire lock
    res.status(409).json({
      success: false,
      message: 'Unable to lock configuration file',
      error: error.message,
      code: 'LOCK_CONFLICT',
    });
  } else {
    // 500 Internal Server Error - Other errors
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

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
    
    // Handle lock errors with appropriate status codes
    if (error instanceof FileLockTimeout || error instanceof FileLockError) {
      handleLockError(error, res);
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to save pools configuration',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
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
    
    // Handle lock errors with appropriate status codes
    if (error instanceof FileLockTimeout || error instanceof FileLockError) {
      handleLockError(error, res);
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to add pool',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
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
    
    // Handle lock errors with appropriate status codes
    if (error instanceof FileLockTimeout || error instanceof FileLockError) {
      handleLockError(error, res);
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to update pool',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
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
    
    // Handle lock errors with appropriate status codes
    if (error instanceof FileLockTimeout || error instanceof FileLockError) {
      handleLockError(error, res);
    } else if (error instanceof Error && error.message.includes('currently in use')) {
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

export default router;
