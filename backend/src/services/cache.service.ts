/**
 * Cache Service
 * 
 * Simple in-memory cache with TTL support
 * Can be easily replaced with Redis in production
 * 
 * @module services/cache
 */

import { logger } from '../utils/logger';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class CacheService {
  private cache: Map<string, CacheEntry<any>>;
  private cleanupInterval: NodeJS.Timeout | null;

  constructor() {
    this.cache = new Map();
    this.cleanupInterval = null;
    this.startCleanup();
  }

  /**
   * Get value from cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.value as T;
  }

  /**
   * Set value in cache with TTL in seconds
   */
  set<T>(key: string, value: T, ttlSeconds: number = 60): void {
    const expiresAt = Date.now() + (ttlSeconds * 1000);
    
    this.cache.set(key, {
      value,
      expiresAt,
    });
  }

  /**
   * Delete value from cache
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(): void {
    // Run cleanup every 60 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      logger.debug(`Cache cleanup: removed ${removed} expired entries`);
    }
  }

  /**
   * Stop cleanup interval (for graceful shutdown)
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Wrap a function with caching
   */
  async wrap<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds: number = 60
  ): Promise<T> {
    // Try to get from cache
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    
    // Execute function and cache result
    const result = await fn();
    this.set(key, result, ttlSeconds);
    
    return result;
  }
}

// Export singleton instance
export const cacheService = new CacheService();

// Middleware for Express to cache responses
export const cacheMiddleware = (ttlSeconds: number = 60) => {
  return async (req: any, res: any, next: any) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }
    
    const cacheKey = `http:${req.originalUrl}`;
    const cached = cacheService.get(cacheKey);
    
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }
    
    // Store original json method
    const originalJson = res.json.bind(res);
    
    // Override json method to cache response
    res.json = (body: any) => {
      cacheService.set(cacheKey, body, ttlSeconds);
      res.set('X-Cache', 'MISS');
      return originalJson(body);
    };
    
    next();
  };
};

export default cacheService;
