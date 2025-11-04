/**
 * Frontend Structured Logging Utility
 * Provides consistent logging format across all services
 * Logs are sent to backend for aggregation
 */

interface LogEntry {
  timestamp: string;
  level: string;
  service: string;
  logger: string;
  message: string;
  hostname: string;
  extra?: Record<string, any>;
  exception?: {
    type: string;
    message: string;
    stack?: string;
  };
}

type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

class FrontendLogger {
  private service: string = 'frontend';
  private hostname: string;
  private logLevel: LogLevel;
  private sendToBackend: boolean;

  constructor() {
    this.hostname = window.location.hostname;
    // Use environment variables if available, otherwise defaults
    this.logLevel = (process.env.REACT_APP_LOG_LEVEL as LogLevel) || 'INFO';
    this.sendToBackend = process.env.REACT_APP_SEND_LOGS_TO_BACKEND === 'true';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      logger: context?.logger || 'frontend',
      message,
      hostname: this.hostname,
    };

    // Add extra context
    if (context) {
      const { logger, ...extra } = context;
      if (Object.keys(extra).length > 0) {
        entry.extra = extra;
      }
    }

    // Add exception info
    if (error) {
      entry.exception = {
        type: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return entry;
  }

  private output(entry: LogEntry): void {
    // Console output (for browser dev tools)
    const consoleMethod = entry.level === 'ERROR' || entry.level === 'CRITICAL' 
      ? 'error' 
      : entry.level === 'WARNING' 
      ? 'warn' 
      : entry.level === 'DEBUG'
      ? 'debug'
      : 'log';

    if (process.env.NODE_ENV === 'development') {
      // Human-readable format for development
      const extra = entry.extra ? ` ${JSON.stringify(entry.extra)}` : '';
      const exception = entry.exception ? `\n${entry.exception.stack}` : '';
      console[consoleMethod](`[${entry.level}] ${entry.message}${extra}${exception}`);
    } else {
      // JSON format for production
      console[consoleMethod](JSON.stringify(entry));
    }

    // Send to backend for aggregation (optional)
    if (this.sendToBackend && (entry.level === 'ERROR' || entry.level === 'CRITICAL')) {
      this.sendToBackendAPI(entry);
    }
  }

  private async sendToBackendAPI(entry: LogEntry): Promise<void> {
    try {
      await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
    } catch (error) {
      // Silently fail - don't want logging to break the app
      console.error('Failed to send log to backend:', error);
    }
  }

  debug(message: string, context?: Record<string, any>): void {
    if (!this.shouldLog('DEBUG')) return;
    const entry = this.createLogEntry('DEBUG', message, context);
    this.output(entry);
  }

  info(message: string, context?: Record<string, any>): void {
    if (!this.shouldLog('INFO')) return;
    const entry = this.createLogEntry('INFO', message, context);
    this.output(entry);
  }

  warning(message: string, context?: Record<string, any>): void {
    if (!this.shouldLog('WARNING')) return;
    const entry = this.createLogEntry('WARNING', message, context);
    this.output(entry);
  }

  error(message: string, context?: Record<string, any>, error?: Error): void {
    if (!this.shouldLog('ERROR')) return;
    const entry = this.createLogEntry('ERROR', message, context, error);
    this.output(entry);
  }

  critical(message: string, context?: Record<string, any>, error?: Error): void {
    if (!this.shouldLog('CRITICAL')) return;
    const entry = this.createLogEntry('CRITICAL', message, context, error);
    this.output(entry);
  }

  // Helper for logging events with context
  logEvent(level: LogLevel, message: string, context?: Record<string, any>): void {
    const method = level.toLowerCase() as 'debug' | 'info' | 'warning' | 'error' | 'critical';
    this[method](message, context);
  }
}

// Global logger instance
export const logger = new FrontendLogger();

/**
 * Setup global error handlers
 * Catches unhandled errors and promise rejections
 */
export function setupGlobalErrorHandlers(): void {
  // Catch unhandled JavaScript errors
  window.onerror = (message, source, lineno, colno, error) => {
    logger.error('Unhandled error', {
      logger: 'window.onerror',
      source,
      lineno,
      colno,
    }, error || new Error(String(message)));
    
    // Return false to allow default error handling
    return false;
  };

  // Catch unhandled promise rejections
  window.onunhandledrejection = (event) => {
    logger.error('Unhandled promise rejection', {
      logger: 'window.onunhandledrejection',
      reason: event.reason,
    }, event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
  };
}

// Convenience functions
export const logEvent = (
  level: LogLevel,
  message: string,
  context?: Record<string, any>
) => {
  logger.logEvent(level, message, context);
};

// Export default logger
export default logger;
