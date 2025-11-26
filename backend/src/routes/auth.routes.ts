import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { sendLoginVerification, checkLoginVerification } from '../services/telegram.service';
import { optionalAuth, authenticate } from '../middleware/auth.middleware';
import { getDatabase } from '../services/database.service';
import { config } from '../config/config';
import {
  issueAuthTokens,
  clearAuthCookies,
  verifyRefreshToken,
  buildUserResponse,
} from '../services/auth.service';

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

// Check verification status and issue JWT if verified
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

    // If verified, issue JWT tokens
    if (verification.verified) {
      const db = getDatabase();
      const adminChatId = process.env.ADMIN_TELEGRAM_CHAT_ID || '';
      const role = chatId === adminChatId ? 'admin' : 'user';
      
      // Get or create user (handles first login automatically)
      const user = db.getOrCreateUserByChatId(chatId, role);

      // Update last login
      db.updateUserLastLogin(user.id!);

      // Issue tokens and set cookies
      issueAuthTokens(res, user);

      // Cleanup verification
      pendingVerifications.delete(chatId);

      logger.info(`User logged in: ${chatId}`, { role: user.role, userId: user.id });

      return res.json({
        verified: true,
        expired: false,
        user: buildUserResponse(user),
      });
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

  // If system user, return basic info
  if (req.user.isSystem) {
    return res.json({
      chatId: req.user.chatId,
      role: req.user.role,
      isSystem: true,
      isAdmin: true,
    });
  }

  // For regular users, fetch full user record
  const db = getDatabase();
  const user = req.user.userId
    ? db.getUserById(req.user.userId)
    : db.getUserByChatId(req.user.chatId);

  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'User not found',
    });
  }

  res.json(buildUserResponse(user));
});

// Refresh access token using refresh token
router.post('/auth/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.[config.auth.refreshCookieName];

    if (!refreshToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No refresh token provided',
      });
    }

    const payload = verifyRefreshToken(refreshToken);
    const db = getDatabase();
    const user = payload.userId
      ? db.getUserById(payload.userId)
      : db.getUserByChatId(payload.chatId);

    if (!user) {
      clearAuthCookies(res);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not found',
      });
    }

    if (user.status === 'suspended') {
      clearAuthCookies(res);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Account suspended',
      });
    }

    // Issue new tokens
    issueAuthTokens(res, user);

    logger.debug(`Token refreshed for user: ${user.telegram_chat_id}`);

    res.json({
      success: true,
      user: buildUserResponse(user),
    });
  } catch (error) {
    logger.warn('Token refresh failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    clearAuthCookies(res);
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired refresh token',
    });
  }
});

// Logout - clear auth cookies
router.post('/auth/logout', (req, res) => {
  clearAuthCookies(res);
  logger.info('User logged out', { chatId: req.user?.chatId });
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
