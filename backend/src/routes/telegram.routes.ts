/**
 * Telegram API Routes
 * 
 * Endpoints for managing Telegram bot configuration
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { getDatabase } from '../services/database.service';
import { initTelegramBot, testConnection, getBotStatus, stopBot } from '../services/telegram.service';

const router = Router();
const db = getDatabase();

/**
 * GET /api/telegram/status
 * Get current Telegram bot status
 */
router.get('/status', (req: Request, res: Response) => {
  try {
    const status = getBotStatus();
    
    res.json({
      success: true,
      enabled: status.enabled,
      chatId: status.chatId,
    });
  } catch (error) {
    logger.error('Error getting Telegram status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get Telegram status',
    });
  }
});

/**
 * POST /api/telegram/init
 * Initialize Telegram bot with token and chat ID
 */
router.post('/init', async (req: Request, res: Response) => {
  try {
    const { token, chatId } = req.body;

    if (!token || !chatId) {
      return res.status(400).json({
        success: false,
        error: 'Bot token and chat ID are required',
      });
    }

    // Validate chat ID is numeric
    if (!/^\d+$/.test(chatId)) {
      return res.status(400).json({
        success: false,
        error: 'Chat ID must be numeric',
      });
    }

    // Stop existing bot if running
    stopBot();

    // Store credentials in database
    db.setSetting('telegram_bot_token', token);
    db.setSetting('telegram_chat_id', chatId);

    // Initialize bot
    initTelegramBot(token, chatId);

    logger.info('Telegram bot initialized via API', {
      chatId: chatId.substring(0, 4) + '***',
    });

    res.json({
      success: true,
      message: 'Telegram bot initialized successfully',
    });
  } catch (error) {
    logger.error('Error initializing Telegram bot:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to initialize bot',
    });
  }
});

/**
 * POST /api/telegram/test
 * Send a test message to verify bot is working
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const result = await testConnection();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    logger.error('Error testing Telegram connection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test connection',
    });
  }
});

/**
 * DELETE /api/telegram
 * Disable Telegram bot and remove credentials
 */
router.delete('/', (req: Request, res: Response) => {
  try {
    // Stop bot
    stopBot();

    // Remove credentials from database
    db.deleteSetting('telegram_bot_token');
    db.deleteSetting('telegram_chat_id');

    logger.info('Telegram bot disabled via API');

    res.json({
      success: true,
      message: 'Telegram bot disabled',
    });
  } catch (error) {
    logger.error('Error disabling Telegram bot:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disable bot',
    });
  }
});

export default router;
