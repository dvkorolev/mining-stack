// backend/src/routes/logs.routes.ts
import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { validateBody } from '../validation/schemas';
import { z } from 'zod';

const router = Router();

/**
 * Frontend log entry schema
 */
const frontendLogSchema = z.object({
  timestamp: z.string(),
  level: z.enum(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']),
  service: z.string().default('frontend'),
  logger: z.string().default('frontend'),
  message: z.string(),
  hostname: z.string(),
  extra: z.record(z.any()).optional(),
  exception: z.object({
    type: z.string(),
    message: z.string(),
    stack: z.string().optional(),
  }).optional(),
});

type FrontendLog = z.infer<typeof frontendLogSchema>;

/**
 * POST /api/logs
 * Receive frontend logs and forward to backend logging system
 */
router.post('/', validateBody(frontendLogSchema), (req: Request, res: Response) => {
  try {
    const logEntry: FrontendLog = req.body;

    // Map frontend log levels to Winston levels
    const levelMap: Record<string, string> = {
      'DEBUG': 'debug',
      'INFO': 'info',
      'WARNING': 'warn',
      'ERROR': 'error',
      'CRITICAL': 'error',
    };

    const winstonLevel = levelMap[logEntry.level] || 'info';

    // Create context object with all frontend log data
    const context: Record<string, any> = {
      service: 'frontend',
      logger: logEntry.logger,
      hostname: logEntry.hostname,
      frontend_timestamp: logEntry.timestamp,
    };

    // Add extra context if present
    if (logEntry.extra) {
      Object.assign(context, logEntry.extra);
    }

    // Add exception details if present
    if (logEntry.exception) {
      context.exception = {
        type: logEntry.exception.type,
        message: logEntry.exception.message,
        stack: logEntry.exception.stack,
      };
    }

    // Log to backend logger with frontend context
    logger.log(winstonLevel, `[FRONTEND] ${logEntry.message}`, context);

    res.status(200).json({
      success: true,
      message: 'Log received',
    });
  } catch (error) {
    // Don't fail the request if logging fails
    logger.error('Failed to process frontend log', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    res.status(200).json({
      success: false,
      message: 'Log processing failed but acknowledged',
    });
  }
});

/**
 * POST /api/logs/batch
 * Receive multiple frontend logs in batch
 */
router.post('/batch', validateBody(z.object({
  logs: z.array(frontendLogSchema),
})), (req: Request, res: Response) => {
  try {
    const { logs } = req.body;

    logs.forEach((logEntry: FrontendLog) => {
      const levelMap: Record<string, string> = {
        'DEBUG': 'debug',
        'INFO': 'info',
        'WARNING': 'warn',
        'ERROR': 'error',
        'CRITICAL': 'error',
      };

      const winstonLevel = levelMap[logEntry.level] || 'info';

      const context: Record<string, any> = {
        service: 'frontend',
        logger: logEntry.logger,
        hostname: logEntry.hostname,
        frontend_timestamp: logEntry.timestamp,
        ...logEntry.extra,
      };

      if (logEntry.exception) {
        context.exception = logEntry.exception;
      }

      logger.log(winstonLevel, `[FRONTEND] ${logEntry.message}`, context);
    });

    res.status(200).json({
      success: true,
      message: `${logs.length} logs received`,
    });
  } catch (error) {
    logger.error('Failed to process frontend log batch', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    res.status(200).json({
      success: false,
      message: 'Log batch processing failed but acknowledged',
    });
  }
});

export default router;
