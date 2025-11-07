/**
 * Authentication Middleware
 * 
 * Provides simple but effective authentication for the mining stack backend.
 * 
 * Two authentication methods:
 * 1. System API Key (for python-scheduler and other internal services)
 * 2. Telegram Chat ID (for user requests via Telegram bot)
 * 
 * Environment Variables:
 * - SYSTEM_API_KEY: Secret key for internal service authentication
 * - ADMIN_TELEGRAM_CHAT_ID: Telegram chat ID of the admin user
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Extend Express Request to include user context
declare global {
  namespace Express {
    interface Request {
      user?: {
        chatId: string;
        role: 'admin' | 'user';
        isSystem: boolean;
      };
    }
  }
}

const SYSTEM_API_KEY = process.env.SYSTEM_API_KEY || '';
const ADMIN_TELEGRAM_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';

/**
 * Authentication middleware
 * Checks for either X-API-Key (system) or X-Telegram-Chat-ID (user)
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const chatId = req.headers['x-telegram-chat-id'] as string | undefined;

  // Check for system API key (highest priority)
  if (apiKey) {
    if (!SYSTEM_API_KEY) {
      logger.warn('System API key authentication attempted but SYSTEM_API_KEY not configured');
      res.status(500).json({ 
        error: 'Server configuration error',
        message: 'System authentication not configured'
      });
      return;
    }

    if (apiKey === SYSTEM_API_KEY) {
      // System authentication successful
      req.user = {
        chatId: 'system',
        role: 'admin',
        isSystem: true,
      };
      logger.debug('System API authenticated', { 
        path: req.path,
        method: req.method 
      });
      next();
      return;
    } else {
      // Invalid API key
      logger.warn('Invalid system API key attempted', {
        path: req.path,
        method: req.method,
        ip: req.ip,
      });
      res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid API key'
      });
      return;
    }
  }

  // Check for Telegram chat ID
  if (chatId) {
    // Determine user role
    const role = chatId === ADMIN_TELEGRAM_CHAT_ID ? 'admin' : 'user';

    req.user = {
      chatId,
      role,
      isSystem: false,
    };

    logger.debug('Telegram user authenticated', {
      chatId: chatId.substring(0, 4) + '***',
      role,
      path: req.path,
      method: req.method,
    });
    next();
    return;
  }

  // No authentication provided
  logger.warn('Unauthenticated request', {
    path: req.path,
    method: req.method,
    ip: req.ip,
  });
  res.status(401).json({ 
    error: 'Unauthorized',
    message: 'Authentication required. Provide X-API-Key or X-Telegram-Chat-ID header.'
  });
};

/**
 * Admin-only middleware
 * Must be used after authenticate middleware
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Authentication required'
    });
    return;
  }

  if (req.user.role !== 'admin') {
    logger.warn('Non-admin user attempted admin action', {
      chatId: req.user.chatId.substring(0, 4) + '***',
      path: req.path,
      method: req.method,
    });
    res.status(403).json({ 
      error: 'Forbidden',
      message: 'Admin access required'
    });
    return;
  }

  next();
};

/**
 * Optional authentication middleware
 * Attaches user context if credentials provided, but doesn't require it
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const chatId = req.headers['x-telegram-chat-id'] as string | undefined;

  // Try system API key
  if (apiKey && SYSTEM_API_KEY && apiKey === SYSTEM_API_KEY) {
    req.user = {
      chatId: 'system',
      role: 'admin',
      isSystem: true,
    };
  }
  // Try Telegram chat ID
  else if (chatId) {
    const role = chatId === ADMIN_TELEGRAM_CHAT_ID ? 'admin' : 'user';
    req.user = {
      chatId,
      role,
      isSystem: false,
    };
  }

  // Continue regardless of authentication status
  next();
};
