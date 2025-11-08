import { Router } from 'express';
import { logger } from '../utils/logger';
import { sendLoginVerification, checkLoginVerification } from '../services/telegram.service';
import { optionalAuth } from '../middleware/auth.middleware';

const router = Router();

// In-memory store for pending verifications (could be Redis in production)
const pendingVerifications = new Map<string, { timestamp: number; verified: boolean }>();

// Cleanup old verifications every 5 minutes
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [chatId, data] of pendingVerifications.entries()) {
    if (data.timestamp < fiveMinutesAgo) {
      pendingVerifications.delete(chatId);
    }
  }
}, 5 * 60 * 1000);

// Request login verification
router.post('/auth/verify-request', async (req, res, next) => {
  try {
    const { chatId } = req.body;
    
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' });
    }
    
    // Validate it's a number
    if (!/^\d+$/.test(chatId)) {
      return res.status(400).json({ error: 'Invalid Chat ID format' });
    }
    
    // Store pending verification
    pendingVerifications.set(chatId, {
      timestamp: Date.now(),
      verified: false,
    });
    
    // Send verification message to Telegram
    const success = await sendLoginVerification(chatId);
    
    if (!success) {
      pendingVerifications.delete(chatId);
      return res.status(400).json({ 
        error: 'Failed to send verification message. Please check your Chat ID.' 
      });
    }
    
    logger.info(`Login verification requested for Chat ID: ${chatId}`);
    res.json({ success: true, message: 'Verification message sent to Telegram' });
    
  } catch (error) {
    next(error);
  }
});

// Check verification status
router.get('/auth/verify-status/:chatId', async (req, res, next) => {
  try {
    const { chatId } = req.params;
    
    const verification = pendingVerifications.get(chatId);
    
    if (!verification) {
      return res.json({ verified: false, expired: true });
    }
    
    // Check if expired (5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (verification.timestamp < fiveMinutesAgo) {
      pendingVerifications.delete(chatId);
      return res.json({ verified: false, expired: true });
    }
    
    res.json({ 
      verified: verification.verified,
      expired: false,
    });
    
  } catch (error) {
    next(error);
  }
});

// Confirm verification (called by Telegram bot)
export const confirmLoginVerification = (chatId: string): boolean => {
  const verification = pendingVerifications.get(chatId);
  
  if (!verification) {
    return false;
  }
  
  verification.verified = true;
  logger.info(`Login verified for Chat ID: ${chatId}`);
  
  // Auto-cleanup after 1 minute
  setTimeout(() => {
    pendingVerifications.delete(chatId);
  }, 60 * 1000);
  
  return true;
};

// Get current user info (requires authentication)
router.get('/auth/me', optionalAuth, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'No authentication provided'
    });
  }
  
  res.json({
    chatId: req.user.chatId,
    role: req.user.role,
    isSystem: req.user.isSystem,
    isAdmin: req.user.role === 'admin',
  });
});

export default router;
