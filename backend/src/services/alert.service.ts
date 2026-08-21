/**
 * Alert Service
 * 
 * Handles alert management and integration with Alertmanager
 * - Receives webhooks from Alertmanager
 * - Forwards alerts to Telegram
 * - Stores alert history (in-memory + SQLite persistence)
 * 
 * @module services/alert
 */

import { logger } from '../utils/logger';
import { sendAlert } from './telegram.service';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs';

export interface Alert {
  id: string;
  name: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'firing' | 'resolved';
  miner?: string;
  minerIp?: string;
  summary: string;
  description: string;
  firedAt: number;
  resolvedAt?: number;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  recipients?: string[]; // Telegram chat IDs to send alert to
  isFarmWide?: boolean; // If true, send to all users
}

// In-memory storage for active alerts
const activeAlerts = new Map<string, Alert>();
const alertHistory: Alert[] = [];
const MAX_HISTORY_SIZE = 1000;

// SQLite database for persistent storage
let db: Database.Database | null = null;
let dbQueue: Promise<void> = Promise.resolve();

interface AlertPersistenceMetrics {
  pendingWrites: number;
  maxPendingWrites: number;
  enqueuedWrites: number;
  completedWrites: number;
  failedWrites: number;
  lastQueueLatencyMs: number;
  averageQueueLatencyMs: number;
  lastWriteDurationMs: number;
  averageWriteDurationMs: number;
}

const queueMetrics = {
  pendingWrites: 0,
  maxPendingWrites: 0,
  enqueuedWrites: 0,
  completedWrites: 0,
  failedWrites: 0,
  lastQueueLatencyMs: 0,
  totalQueueLatencyMs: 0,
  lastWriteDurationMs: 0,
  totalWriteDurationMs: 0,
};

/**
 * Initialize SQLite database for alert persistence
 */
const initDatabase = (): void => {
  try {
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const dbPath = path.join(dataDir, 'alerts.db');
    db = new Database(dbPath);
    
    // Create alerts table
    db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        miner TEXT,
        summary TEXT NOT NULL,
        description TEXT,
        fired_at INTEGER NOT NULL,
        resolved_at INTEGER,
        labels TEXT,
        annotations TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      
      CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
      CREATE INDEX IF NOT EXISTS idx_alerts_miner ON alerts(miner);
      CREATE INDEX IF NOT EXISTS idx_alerts_fired_at ON alerts(fired_at DESC);
      CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
    `);
    
    logger.info('Alert database initialized', { dbPath });
  } catch (error) {
    logger.error('Failed to initialize alert database', error);
  }
};

/**
 * Save alert to database
 */

const enqueueAlertPersistence = (alert: Alert): void => {
  if (!db) {
    logger.error('Alert DB not initialized — alert persistence skipped', { alertId: alert.id });
    queueMetrics.failedWrites += 1;
    return;
  }

  queueMetrics.enqueuedWrites += 1;
  queueMetrics.pendingWrites += 1;
  if (queueMetrics.pendingWrites > queueMetrics.maxPendingWrites) {
    queueMetrics.maxPendingWrites = queueMetrics.pendingWrites;
  }

  const enqueuedAt = Date.now();

  dbQueue = dbQueue
    .then(async () => {
      const activeDb = db;
      const queueLatency = Date.now() - enqueuedAt;
      queueMetrics.lastQueueLatencyMs = queueLatency;
      queueMetrics.totalQueueLatencyMs += queueLatency;

      try {
        if (!activeDb) {
          queueMetrics.failedWrites += 1;
          return;
        }

        const start = Date.now();
        const stmt = activeDb.prepare(`
          INSERT OR REPLACE INTO alerts (id, name, severity, status, miner, summary, description, fired_at, resolved_at, labels, annotations)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          alert.id,
          alert.name,
          alert.severity,
          alert.status,
          alert.miner || null,
          alert.summary,
          alert.description,
          alert.firedAt,
          alert.resolvedAt || null,
          JSON.stringify(alert.labels),
          JSON.stringify(alert.annotations)
        );

        const duration = Date.now() - start;
        queueMetrics.lastWriteDurationMs = duration;
        queueMetrics.totalWriteDurationMs += duration;
        queueMetrics.completedWrites += 1;
      } catch (error) {
        queueMetrics.failedWrites += 1;
        throw error;
      } finally {
        queueMetrics.pendingWrites = Math.max(queueMetrics.pendingWrites - 1, 0);
      }
    })
    .catch((error: unknown) => {
      logger.error('Alert DB queue task failed', { alertId: alert.id, error });
    });
};

/**
 * Load recent alerts from database on startup
 */
const loadAlertsFromDb = (): void => {
  if (!db) return;
  
  try {
    const stmt = db.prepare(`
      SELECT * FROM alerts 
      WHERE fired_at > ? 
      ORDER BY fired_at DESC 
      LIMIT ?
    `);
    
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const rows = stmt.all(last24h, MAX_HISTORY_SIZE) as any[];
    
    // Use a Map to deduplicate alerts by ID (keep most recent version)
    const alertsMap = new Map<string, Alert>();
    
    rows.forEach(row => {
      const alert: Alert = {
        id: row.id,
        name: row.name,
        severity: row.severity,
        status: row.status,
        miner: row.miner,
        summary: row.summary,
        description: row.description,
        firedAt: row.fired_at,
        resolvedAt: row.resolved_at,
        labels: JSON.parse(row.labels || '{}'),
        annotations: JSON.parse(row.annotations || '{}'),
      };
      
      // Only keep the most recent version of each alert
      if (!alertsMap.has(alert.id)) {
        alertsMap.set(alert.id, alert);
      }
    });
    
    // Convert map to array and add to storage
    let legacyDropped = 0;
    alertsMap.forEach(alert => {
      // Add to in-memory storage
      if (alert.status === 'firing') {
        // An id from an older scheme can never be matched by a resolve webhook,
        // which generates the current scheme — restoring one would leave it
        // "active" forever (DMI-71). Dropping it is safe: Alertmanager re-sends
        // every still-firing alert each group_interval, so anything genuinely
        // firing reappears within minutes under a correct id, and anything that
        // does not reappear had already resolved.
        if (!alert.id.startsWith(`${ALERT_ID_SCHEME}_`)) {
          legacyDropped++;
        } else {
          activeAlerts.set(alert.id, alert);
        }
      }
      alertHistory.push(alert);
    });

    logger.info('Loaded alerts from database', {
      activeCount: activeAlerts.size,
      historyCount: alertHistory.length,
      legacyActiveDropped: legacyDropped,
    });
    if (legacyDropped > 0) {
      logger.warn(
        `Dropped ${legacyDropped} active alert(s) using a pre-${ALERT_ID_SCHEME} id scheme; ` +
        `Alertmanager will re-deliver any that are still firing`
      );
    }
  } catch (error) {
    logger.error('Failed to load alerts from database', error);
  }
};

/**
 * Initialize the alert database and load recent alerts.
 * Must be called explicitly during server startup after the data volume is mounted.
 */
export const initAlertDatabase = (): void => {
  initDatabase();
  loadAlertsFromDb();
};

/**
 * Process incoming alert webhook from Alertmanager
 */
export const processAlertWebhook = async (payload: any): Promise<void> => {
  try {
    const alerts = payload.alerts || [];
    
    for (const alert of alerts) {
      const alertId = generateAlertId(alert);
      const severity = (alert.labels?.severity || 'info') as 'critical' | 'warning' | 'info';
      const status = alert.status as 'firing' | 'resolved';
      
      const minerName = alert.labels?.miner || alert.labels?.name;
      const minerIp = alert.labels?.ip;
      
      // Determine if this is a farm-wide alert or miner-specific
      const isFarmWide = !minerName || alert.labels?.alertname?.toLowerCase().includes('farm');
      
      // Get recipients for this alert
      const recipients = await determineAlertRecipients(minerIp, isFarmWide);
      
      const alertData: Alert = {
        id: alertId,
        name: alert.labels?.alertname || 'Unknown',
        severity,
        status,
        miner: minerName,
        minerIp,
        summary: alert.annotations?.summary || '',
        description: alert.annotations?.description || '',
        firedAt: new Date(alert.startsAt).getTime(),
        resolvedAt: status === 'resolved' ? new Date(alert.endsAt).getTime() : undefined,
        labels: alert.labels || {},
        annotations: alert.annotations || {},
        recipients,
        isFarmWide,
      };

      // Record the alert before attempting to notify. Delivery is best-effort and
      // can be a deliberate no-op (see notifier.service); the record must not be.
      addToHistory(alertData);

      if (status === 'firing') {
        // Guard against duplicate sends when Alertmanager re-delivers
        // the same webhook for an already-tracked firing (same startsAt -> same ID).
        const isNewFiring = !activeAlerts.has(alertId);
        activeAlerts.set(alertId, alertData);
        
        if (isNewFiring) {
          const { notifyAlert } = require('./notifier.service');
          const delivery = await notifyAlert({
            severity: alertData.severity,
            title: alertData.summary,
            description: alertData.description,
            miner: alertData.miner,
            recipients: alertData.recipients,
            isFarmWide: alertData.isFarmWide,
          });
          
          const recipientInfo = alertData.isFarmWide ? 'all users' : `${alertData.recipients?.length || 0} owner(s)`;
          // State the delivery outcome, never assume it. The previous version of
          // this line claimed "(sent to ...)" whether or not anything was sent.
          logger.info(
            `Alert fired: ${alertData.name} - ${alertData.summary} ` +
            `[notify: ${delivery.channel}/${delivery.outcome}` +
            `${delivery.reason ? ` - ${delivery.reason}` : ''}; intended for ${recipientInfo}]`
          );
        } else {
          logger.debug(`Duplicate webhook delivery ignored for alert: ${alertId}`);
        }
      } else if (status === 'resolved') {
        activeAlerts.delete(alertId);
        alertData.resolvedAt = Date.now();
        
        const resolvedEmoji = severity === 'critical' ? '✅' : severity === 'warning' ? '✔️' : 'ℹ️';
        const { notifyAlert } = require('./notifier.service');
        const delivery = await notifyAlert({
          severity: 'info',
          title: `${resolvedEmoji} Resolved: ${alertData.name}`,
          description: alertData.summary,
          miner: alertData.miner,
          recipients: alertData.recipients,
          isFarmWide: alertData.isFarmWide,
        });
        
        logger.info(
          `Alert resolved: ${alertData.name} - ${alertData.summary} ` +
          `[notify: ${delivery.channel}/${delivery.outcome}]`
        );
      }
    }
  } catch (error) {
    logger.error('Error processing alert webhook:', error);
    throw error;
  }
};

/**
 * Get all active alerts
 */
export const getActiveAlerts = (): Alert[] => {
  return Array.from(activeAlerts.values());
};

/**
 * Get alert history
 */
export const getAlertHistory = (limit: number = 100): Alert[] => {
  return alertHistory.slice(0, limit);
};

/**
 * Get alerts for specific miner
 */
export const getMinerAlerts = (minerId: string): Alert[] => {
  return Array.from(activeAlerts.values()).filter(
    alert => alert.miner === minerId
  );
};

/**
 * Clear resolved alerts from history
 */
export const clearResolvedAlerts = (): void => {
  const resolved = alertHistory.filter(a => a.status === 'resolved');
  logger.info(`Cleared ${resolved.length} resolved alerts from history`);
};

/**
 * Clean up duplicate alerts from database
 * Keeps only the most recent version of each alert ID
 */
export const cleanupDuplicateAlerts = (): { removed: number } => {
  if (!db) {
    logger.warn('Cannot cleanup duplicates: database not initialized');
    return { removed: 0 };
  }
  
  try {
    // Find duplicate alert IDs
    const duplicatesStmt = db.prepare(`
      SELECT id, COUNT(*) as count 
      FROM alerts 
      GROUP BY id 
      HAVING count > 1
    `);
    
    const duplicates = duplicatesStmt.all() as { id: string; count: number }[];
    
    if (duplicates.length === 0) {
      logger.info('No duplicate alerts found in database');
      return { removed: 0 };
    }
    
    let totalRemoved = 0;
    
    // For each duplicate, keep only the most recent entry
    for (const dup of duplicates) {
      const keepStmt = db.prepare(`
        SELECT rowid FROM alerts 
        WHERE id = ? 
        ORDER BY created_at DESC 
        LIMIT 1
      `);
      
      const keepRow = keepStmt.get(dup.id) as { rowid: number } | undefined;
      
      if (keepRow) {
        const deleteStmt = db.prepare(`
          DELETE FROM alerts 
          WHERE id = ? AND rowid != ?
        `);
        
        const result = deleteStmt.run(dup.id, keepRow.rowid);
        totalRemoved += result.changes;
      }
    }
    
    logger.info(`Cleaned up ${totalRemoved} duplicate alerts from database`, {
      duplicateIds: duplicates.length,
      rowsRemoved: totalRemoved
    });
    
    return { removed: totalRemoved };
  } catch (error) {
    logger.error('Failed to cleanup duplicate alerts', error);
    return { removed: 0 };
  }
};

/**
 * Determine which users should receive this alert
 * @param minerIp IP address of the miner (if miner-specific alert)
 * @param isFarmWide If true, send to all users
 * @returns Array of Telegram chat IDs
 */
const determineAlertRecipients = async (minerIp?: string, isFarmWide?: boolean): Promise<string[]> => {
  try {
    // Farm-wide alerts go to everyone
    if (isFarmWide || !minerIp) {
      const { getBotStatus } = require('./telegram.service');
      const status = getBotStatus();
      return status.chatIds || [];
    }
    
    // Miner-specific alerts go to the miner's owner(s)
    const { getDatabase } = require('./database.service');
    const db = getDatabase();
    const miner = db.getMinerByIp(minerIp);
    
    if (miner && miner.owner) {
      // Return owner as array
      return [miner.owner];
    }
    
    // If no owner found, send to all users (fallback)
    const { getBotStatus } = require('./telegram.service');
    const status = getBotStatus();
    return status.chatIds || [];
  } catch (error) {
    logger.error('Error determining alert recipients:', error);
    // Fallback: send to all users
    const { getBotStatus } = require('./telegram.service');
    const status = getBotStatus();
    return status.chatIds || [];
  }
};

/**
 * Generate unique alert ID
 */
/**
 * Prefix identifying the current alert-id scheme. Bump it whenever the scheme
 * changes: ids generated by an older scheme can never be matched by a newer
 * resolve webhook, so they must be recognisable and dropped (see loadAlertsFromDb).
 */
export const ALERT_ID_SCHEME = 'v2';

/**
 * Build a stable, unique id for one alert instance.
 *
 * The previous scheme keyed on `alertname_(miner || instance)_startsAt` and
 * collapsed the entire fleet into a single id (DMI-71): no mining rule sets a
 * `miner` label, `instance` is the scrape target and therefore identical for
 * every miner (all miner_* series come from the one python-scheduler endpoint),
 * and startsAt is shared by every alert in an evaluation cycle. Measured live:
 * 14 MinerErrors alerts produced 1 distinct id, so 13 miners were silently
 * overwritten in both activeAlerts and alertHistory and never notified.
 *
 * The label set is what identifies an alert instance, so hash all of it. This
 * needs no cooperation from the rules — a rule that forgets a label cannot
 * reintroduce the collapse.
 */
const generateAlertId = (alert: any): string => {
  const labels = alert.labels || {};

  // Sorted, unit-separator-joined so that neither key order nor a value
  // containing a separator character can make two different label sets collide.
  const canonical = Object.keys(labels)
    .sort()
    .map(k => `${k}\x1f${labels[k]}`)
    .join('\x1e');
  const fingerprint = createHash('sha1').update(canonical).digest('hex').slice(0, 16);

  // startsAt separates one firing of an alert from a later, distinct firing of
  // the same alert. Alertmanager always sends it; if it is ever missing, fall
  // back to a fixed marker rather than Date.now(). A clock-based value looks
  // like a valid id while making every re-delivery unique, which would defeat
  // the duplicate guard and notify on every webhook.
  let ts: string;
  if (alert.startsAt) {
    ts = String(new Date(alert.startsAt).getTime());
  } else {
    ts = 'nostart';
    logger.warn('Alert webhook has no startsAt; separate firings will share one id', {
      alertname: labels.alertname,
    });
  }

  const name = labels.alertname || 'unnamed';
  return `${ALERT_ID_SCHEME}_${name}_${fingerprint}_${ts}`;
};

/**
 * Add alert to history (in-memory and database)
 * Updates existing alert if it already exists (by ID)
 */
const addToHistory = (alert: Alert): void => {
  // Check if alert already exists in history
  const existingIndex = alertHistory.findIndex(a => a.id === alert.id);
  
  if (existingIndex !== -1) {
    // Update existing alert in place
    alertHistory[existingIndex] = alert;
  } else {
    // Add new alert to beginning of history
    alertHistory.unshift(alert);
    
    // Keep history size limited
    if (alertHistory.length > MAX_HISTORY_SIZE) {
      alertHistory.splice(MAX_HISTORY_SIZE);
    }
  }
  
  // Persist to database
  enqueueAlertPersistence(alert);
};

/**
 * Get alert statistics
 */
export const getAlertStats = (): {
  active: number;
  critical: number;
  warning: number;
  info: number;
  total24h: number;
} => {
  const active = activeAlerts.size;
  const activeList = Array.from(activeAlerts.values());
  
  const critical = activeList.filter(a => a.severity === 'critical').length;
  const warning = activeList.filter(a => a.severity === 'warning').length;
  const info = activeList.filter(a => a.severity === 'info').length;
  
  const last24h = Date.now() - 24 * 60 * 60 * 1000;
  const total24h = alertHistory.filter(a => a.firedAt >= last24h).length;
  
  return { active, critical, warning, info, total24h };
};

export const getAlertPersistenceMetrics = (): AlertPersistenceMetrics => {
  const averageQueueLatencyMs =
    queueMetrics.enqueuedWrites > 0
      ? queueMetrics.totalQueueLatencyMs / queueMetrics.enqueuedWrites
      : 0;
  const averageWriteDurationMs =
    queueMetrics.completedWrites > 0
      ? queueMetrics.totalWriteDurationMs / queueMetrics.completedWrites
      : 0;

  return {
    pendingWrites: queueMetrics.pendingWrites,
    maxPendingWrites: queueMetrics.maxPendingWrites,
    enqueuedWrites: queueMetrics.enqueuedWrites,
    completedWrites: queueMetrics.completedWrites,
    failedWrites: queueMetrics.failedWrites,
    lastQueueLatencyMs: queueMetrics.lastQueueLatencyMs,
    averageQueueLatencyMs,
    lastWriteDurationMs: queueMetrics.lastWriteDurationMs,
    averageWriteDurationMs,
  };
};

/**
 * Create a manual alert (triggered by user via UI)
 */
export const createManualAlert = async (params: {
  name: string;
  severity: 'critical' | 'warning' | 'info';
  summary: string;
  description: string;
  miner?: string;
  minerIp?: string;
  isFarmWide?: boolean;
  recipients?: string[];
}): Promise<Alert> => {
  const alertId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = Date.now();
  
  // Determine recipients
  let alertRecipients = params.recipients;
  if (!alertRecipients || alertRecipients.length === 0) {
    alertRecipients = await determineAlertRecipients(params.minerIp, params.isFarmWide);
  }
  
  const alert: Alert = {
    id: alertId,
    name: params.name,
    severity: params.severity,
    status: 'firing',
    miner: params.miner,
    minerIp: params.minerIp,
    summary: params.summary,
    description: params.description,
    firedAt: now,
    labels: {
      alertname: params.name,
      severity: params.severity,
      source: 'manual',
      miner: params.miner || '',
      ip: params.minerIp || '',
    },
    annotations: {
      summary: params.summary,
      description: params.description,
    },
    recipients: alertRecipients,
    isFarmWide: params.isFarmWide || false,
  };
  
  // Add to active alerts
  activeAlerts.set(alertId, alert);
  
  // Add to history
  addToHistory(alert);
  
  // Send to Telegram
  const { sendSmartAlert } = require('./telegram.service');
  await sendSmartAlert({
    severity: alert.severity,
    title: alert.summary,
    description: alert.description,
    miner: alert.miner,
    recipients: alert.recipients,
    isFarmWide: alert.isFarmWide,
  });
  
  const recipientInfo = alert.isFarmWide ? 'all users' : `${alert.recipients?.length || 0} user(s)`;
  logger.info(`Manual alert created: ${alert.name} - ${alert.summary} (sent to ${recipientInfo})`);
  
  return alert;
};

/**
 * Resolve a manual alert
 */
export const resolveManualAlert = async (alertId: string): Promise<boolean> => {
  const alert = activeAlerts.get(alertId);
  
  if (!alert) {
    logger.warn(`Attempted to resolve non-existent alert: ${alertId}`);
    return false;
  }
  
  // Update alert status
  alert.status = 'resolved';
  alert.resolvedAt = Date.now();
  
  // Remove from active alerts
  activeAlerts.delete(alertId);
  
  // Update in history
  addToHistory(alert);
  
  // Send resolution notification
  const resolvedEmoji = alert.severity === 'critical' ? '✅' : alert.severity === 'warning' ? '✔️' : 'ℹ️';
  const { sendSmartAlert } = require('./telegram.service');
  await sendSmartAlert({
    severity: 'info',
    title: `${resolvedEmoji} Resolved: ${alert.name}`,
    description: alert.summary,
    miner: alert.miner,
    recipients: alert.recipients,
    isFarmWide: alert.isFarmWide,
  });
  
  logger.info(`Manual alert resolved: ${alert.name} - ${alert.summary}`);
  
  return true;
};
