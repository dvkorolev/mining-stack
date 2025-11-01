import { Router } from 'express';
import { 
  getMiningStats, 
  getHistoricalStats, 
  getDatabaseInfo, 
  backupDatabase,
  discoverMiners,
  startMining, 
  stopMining, 
  restartMiner, 
  updateMinerConfig 
} from '../services/mining.service';
import { getMiners, addMiner, updateMiner, deleteMiner } from '../config/miners.config';

const router = Router();

// Get current mining stats
router.get('/mining/stats', async (req, res, next) => {
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
    const miners = getMiners();
    res.json({ miners });
  } catch (error) {
    next(error);
  }
});

// Add new miner
router.post('/mining/miners', async (req, res, next) => {
  try {
    const { name, ip, model, alias, owner } = req.body;
    
    if (!ip || !model) {
      return res.status(400).json({ error: 'IP and model are required' });
    }
    
    const newMiner = addMiner({ name, ip, model, alias, owner });
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

// Trigger auto-discovery
router.post('/mining/discover', async (req, res, next) => {
  try {
    const result = await discoverMiners();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
