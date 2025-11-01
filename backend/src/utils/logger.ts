import winston from 'winston';
import path from 'path';
import { config } from '../config/config';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format,
  transports: [
    // Write all logs with level `error` and below to `error.log`
    new winston.transports.File({ 
      filename: path.join(config.paths.logs, 'error.log'), 
      level: 'error' 
    }),
    // Write all logs with level `info` and below to `combined.log`
    new winston.transports.File({ 
      filename: path.join(config.paths.logs, 'combined.log') 
    }),
    // Write Telegram-specific logs
    new winston.transports.File({
      filename: path.join(config.paths.logs, 'telegram.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format((info) => {
          const { message, ...meta } = info;
          const msgStr = String(message);
          // Only log messages with telegram context
          if (meta.service === 'telegram' || msgStr.toLowerCase().includes('telegram')) {
            return info;
          }
          return false; // Filter out non-telegram logs
        })(),
        winston.format.printf((info) => {
          const { timestamp, level, message, ...meta } = info;
          return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
    }),
  ],
});

// If we're not in production, log to the console as well
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

export { logger };

export default logger;
