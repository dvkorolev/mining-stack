// backend/src/utils/fileLock.ts
import fs from 'fs';
import path from 'path';
import { logger } from './logger';

/**
 * File Locking Utility for Config Files
 * 
 * Provides a robust file-based locking mechanism to prevent race conditions
 * when multiple processes attempt to write to shared configuration files.
 * 
 * This prevents catastrophic config corruption that could bring down the entire stack.
 */

export class FileLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileLockError';
  }
}

export class FileLockTimeout extends FileLockError {
  constructor(message: string) {
    super(message);
    this.name = 'FileLockTimeout';
  }
}

interface LockInfo {
  pid: number;
  time: number;
  age_seconds?: number;
  error?: string;
}

/**
 * Acquire an exclusive lock on a config file.
 * 
 * Creates a .lock file to prevent concurrent writes. Uses try...finally
 * to guarantee the lock is released even if an exception occurs.
 * 
 * @param filename - Path to the config file to lock
 * @param timeout - Maximum time to wait for lock acquisition (milliseconds)
 * @param pollInterval - Time between lock acquisition attempts (milliseconds)
 * @returns Promise that resolves when lock is acquired
 * @throws FileLockTimeout if lock cannot be acquired within timeout period
 */
async function acquireLock(
  filename: string,
  timeout: number = 10000,
  pollInterval: number = 100
): Promise<() => void> {
  const lockFile = `${filename}.lock`;
  const startTime = Date.now();

  while (true) {
    try {
      // Try to create lock file exclusively (fails if exists)
      // Using wx flag ensures atomic creation
      const lockInfo = {
        pid: process.pid,
        time: Date.now(),
      };

      fs.writeFileSync(lockFile, JSON.stringify(lockInfo, null, 2), {
        flag: 'wx', // Create file, fail if exists
        mode: 0o644,
      });

      logger.debug(`Acquired lock on ${filename}`);

      // Return release function
      return () => {
        try {
          fs.unlinkSync(lockFile);
          logger.debug(`Released lock on ${filename}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.error(`Error releasing lock on ${filename}:`, error);
          }
        }
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;

      // If file exists, wait and retry
      if (err.code === 'EEXIST') {
        const elapsed = Date.now() - startTime;

        if (elapsed >= timeout) {
          // Try to read lock file to see who has it
          let lockHolder = 'unknown';
          try {
            const lockContent = fs.readFileSync(lockFile, 'utf8');
            lockHolder = lockContent.trim();
          } catch {
            // Ignore read errors
          }

          throw new FileLockTimeout(
            `Failed to acquire lock on ${filename} after ${timeout}ms. Lock held by: ${lockHolder}`
          );
        }

        // Wait and retry
        logger.debug(`Waiting for lock on ${filename} (${elapsed}ms elapsed)`);
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } else {
        // Other error, rethrow
        throw new FileLockError(`Failed to acquire lock on ${filename}: ${err.message}`);
      }
    }
  }
}

/**
 * Execute a function with an exclusive lock on a config file.
 * 
 * @param filename - Path to the config file to lock
 * @param fn - Function to execute while holding the lock
 * @param timeout - Maximum time to wait for lock acquisition (milliseconds)
 * @returns Promise that resolves with the function's return value
 * 
 * @example
 * await withConfigLock('/app/etc/pools.yaml', async () => {
 *   fs.writeFileSync('/app/etc/pools.yaml', yaml.dump(config));
 * });
 */
export async function withConfigLock<T>(
  filename: string,
  fn: () => T | Promise<T>,
  timeout: number = 10000
): Promise<T> {
  const releaseLock = await acquireLock(filename, timeout);

  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

/**
 * Check if a file is currently locked.
 * 
 * @param filename - Path to the config file
 * @returns Lock info if locked, null if not locked
 */
export function checkLockStatus(filename: string): LockInfo | null {
  const lockFile = `${filename}.lock`;

  try {
    if (!fs.existsSync(lockFile)) {
      return null;
    }

    const content = fs.readFileSync(lockFile, 'utf8');
    const info = JSON.parse(content) as LockInfo;

    // Add lock file age
    const stats = fs.statSync(lockFile);
    info.age_seconds = (Date.now() - stats.mtimeMs) / 1000;

    return info;
  } catch (error) {
    logger.error(`Error reading lock file ${lockFile}:`, error);
    return {
      pid: 0,
      time: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Force release a lock (use with caution!).
 * 
 * This should only be used in emergency situations where a lock
 * is stuck due to a crashed process.
 * 
 * @param filename - Path to the config file
 * @returns True if lock was released, false if no lock existed
 */
export function forceReleaseLock(filename: string): boolean {
  const lockFile = `${filename}.lock`;

  try {
    fs.unlinkSync(lockFile);
    logger.warn(`Force released lock on ${filename}`);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return false;
    }
    logger.error(`Error force releasing lock on ${filename}:`, error);
    throw error;
  }
}

/**
 * Convenience function for safely writing YAML config files with locking.
 * 
 * @example
 * await safeWriteYaml('/app/etc/pools.yaml', async () => {
 *   fs.writeFileSync('/app/etc/pools.yaml', yaml.dump(config));
 * });
 */
export async function safeWriteYaml<T>(
  filename: string,
  fn: () => T | Promise<T>,
  timeout: number = 10000
): Promise<T> {
  return withConfigLock(filename, fn, timeout);
}

/**
 * Convenience function for safely writing JSON config files with locking.
 * 
 * @example
 * await safeWriteJson('/app/etc/config.json', async () => {
 *   fs.writeFileSync('/app/etc/config.json', JSON.stringify(config));
 * });
 */
export async function safeWriteJson<T>(
  filename: string,
  fn: () => T | Promise<T>,
  timeout: number = 10000
): Promise<T> {
  return withConfigLock(filename, fn, timeout);
}
