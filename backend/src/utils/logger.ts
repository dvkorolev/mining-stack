import winston from 'winston';
import path from 'path';
import os from 'os';
import { config } from '../config/config';

// Service name for structured logging
const SERVICE_NAME = 'backend';
const HOSTNAME = os.hostname();

// Define log levels (matching Python logging levels)
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Map Winston levels to Python-style levels
const levelMap: { [key: string]: string } = {
  error: 'ERROR',
  warn: 'WARNING',
  info: 'INFO',
  http: 'INFO',
  debug: 'DEBUG',
};

// Structured JSON format matching python-scheduler
const structuredFormat = winston.format.printf((info) => {
  const { timestamp, level, message, stack, ...extra } = info;
  
  const logEntry: any = {
    timestamp: timestamp ? new Date(timestamp as string).toISOString() : new Date().toISOString(),
    level: levelMap[level] || level.toUpperCase(),
    service: SERVICE_NAME,
    logger: extra.logger || 'backend',
    message: message,
    hostname: HOSTNAME,
  };
  
  // Add exception info if present
  if (stack) {
    logEntry.exception = {
      type: extra.name || 'Error',
      message: message,
      traceback: stack,
    };
  }
  
  // Add extra fields
  const extraFields: any = {};
  for (const [key, value] of Object.entries(extra)) {
    if (!['name', 'logger', 'service'].includes(key)) {
      extraFields[key] = value;
    }
  }
  
  if (Object.keys(extraFields).length > 0) {
    logEntry.extra = extraFields;
  }
  
  return JSON.stringify(logEntry);
});

// Human-readable format for development
const humanFormat = winston.format.printf((info) => {
  const { timestamp, level, message, stack, ...extra } = info;
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : '';
  const stackStr = stack ? `\n${stack}` : '';
  return `${timestamp} [${level.toUpperCase()}] ${message}${extraStr}${stackStr}`;
});

// Choose format based on LOG_FORMAT environment variable
const logFormat = process.env.LOG_FORMAT === 'json'
  ? winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      structuredFormat
    )
  : winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.colorize(),
      humanFormat
    );

/**
 * Resolve LOG_LEVEL to a level winston actually knows.
 *
 * Winston matches the configured level against `levels` by exact string. An
 * unrecognised value does not fall back and does not complain -- it silently
 * suppresses every log line. That is not hypothetical: this site ran with
 * `LOG_LEVEL=INFO` (uppercase) and the backend's entire application log was
 * empty for as long as anyone had looked, while morgan's HTTP lines kept
 * arriving and made the container look healthy.
 *
 * So: normalise case, and refuse to honour a level that does not exist --
 * loudly, on the one transport that is guaranteed to work.
 */
const resolveLogLevel = (): string => {
  const raw = (process.env.LOG_LEVEL || 'info').trim();
  const normalised = raw.toLowerCase();
  if (normalised in levels) {
    return normalised;
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[logger] LOG_LEVEL="${raw}" is not one of ${Object.keys(levels).join('/')}; ` +
      `falling back to "info". An unknown level silences all logging.`
  );
  return 'info';
};

// Create the logger
const logger = winston.createLogger({
  level: resolveLogLevel(),
  levels,
  format: logFormat,
  transports: [
    // Console output (will be collected by Promtail)
    new winston.transports.Console(),
  ],
});

// Helper function for structured logging with context
export const logEvent = (
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, any>
) => {
  logger.log(level, message, context || {});
};

// Log startup message
logger.info('Logging configured', {
  log_format: process.env.LOG_FORMAT || 'human',
  // The level in force, not the one that was asked for -- they differ whenever
  // LOG_LEVEL is unrecognised, which is exactly when you need to be told.
  log_level: logger.level,
  service: SERVICE_NAME,
});

export { logger };
export default logger;
