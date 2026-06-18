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
import { config } from '../config/config';
import { getDatabase, UserRecord } from '../services/database.service';
import { verifyAccessToken } from '../services/auth.service';

// Extend Express Request to include user context
declare global {
  namespace Express {
    interface Request {
      user?: {
        chatId: string;
        role: 'admin' | 'user';
        isSystem: boolean;
        userId?: number;
      };
    }
  }
}

const SYSTEM_API_KEY = process.env.SYSTEM_API_KEY || '';
const ADMIN_TELEGRAM_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';

if (config.auth.allowLegacyHeaderAuth) {
  logger.warn('ALLOW_LEGACY_HEADER_AUTH is enabled. Legacy X-Telegram-Chat-ID authentication is active and insecure.');
}

const getAccessTokenFromRequest = (req: Request): string | null => {
  const cookieToken = req.cookies?.[config.auth.accessCookieName];
  if (cookieToken) {
    return cookieToken;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7);
  }

  return null;
};

const setUserContextFromRecord = (req: Request, user: UserRecord): void => {
  req.user = {
    chatId: user.telegram_chat_id,
    role: user.role,
    isSystem: false,
    userId: user.id,
  };
};

const tryJwtAuth = (req: Request, requireActiveUser: boolean = true): boolean => {
  const token = getAccessTokenFromRequest(req);
  if (!token) {
    return false;
  }

  try {
    const payload = verifyAccessToken(token);
    const db = getDatabase();
    const user = payload.userId
      ? db.getUserById(payload.userId)
      : db.getUserByChatId(payload.chatId);

    if (!user) {
      throw new Error('User not found');
    }

    if (requireActiveUser && user.status === 'suspended') {
      throw new Error('User suspended');
    }

    setUserContextFromRecord(req, user);
    return true;
  } catch (error) {
    logger.warn('JWT authentication failed', {
      path: req.path,
      method: req.method,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

const tryLegacyChatHeader = (req: Request): boolean => {
  const chatId = req.headers['x-telegram-chat-id'] as string | undefined;
  if (!chatId) {
    return false;
  }

  const role = chatId === ADMIN_TELEGRAM_CHAT_ID ? 'admin' : 'user';
  req.user = {
    chatId,
    role,
    isSystem: false,
  };

  logger.warn('Legacy X-Telegram-Chat-ID authentication used. Please migrate to JWT.', {
    path: req.path,
    method: req.method,
  });

  return true;
};

const applySystemAuth = (req: Request, apiKey?: string): boolean => {
  if (!apiKey) {
    return false;
  }

  if (!SYSTEM_API_KEY) {
    logger.warn('System API key provided but SYSTEM_API_KEY env not configured');
    return false;
  }

  if (apiKey !== SYSTEM_API_KEY) {
    logger.warn('Invalid system API key attempted', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    return false;
  }

  req.user = {
    chatId: 'system',
    role: 'admin',
    isSystem: true,
  };
  logger.debug('System API authenticated', {
    path: req.path,
    method: req.method,
  });
  return true;
};

const ensureAuthenticated = (
  req: Request,
  res: Response,
  next: NextFunction,
  required: boolean
): void => {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (applySystemAuth(req, apiKey)) {
    next();
    return;
  }

  if (tryJwtAuth(req)) {
    next();
    return;
  }

  if (config.auth.allowLegacyHeaderAuth && tryLegacyChatHeader(req)) {
    next();
    return;
  }

  if (required) {
    logger.warn('Unauthenticated request', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  next();
};

/**
 * Authentication middleware
 * Checks for either X-API-Key (system) or X-Telegram-Chat-ID (user)
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  ensureAuthenticated(req, res, next, true);
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
  ensureAuthenticated(req, res, next, false);
};
