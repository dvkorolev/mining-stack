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
import path from 'path';
import fs from 'fs';

export interface Alert {
  id: string;
  name: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'firing' | 'resolved';
  miner?: string;
  summary: string;
  description: string;
  firedAt: number;
  resolvedAt?: number;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

// In-memory storage for active alerts
const activeAlerts = new Map<string, Alert>();
const alertHistory: Alert[] = [];
const MAX_HISTORY_SIZE = 1000;

// SQLite database for persistent storage
let db: Database.Database | null = null;

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
const saveAlertToDb = (alert: Alert): void => {
  if (!db) return;
  
  try {
    const stmt = db.prepare(`
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
  } catch (error) {
    logger.error('Failed to save alert to database', { alertId: alert.id, error });
  }
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
      
      // Add to in-memory storage
      if (alert.status === 'firing') {
        activeAlerts.set(alert.id, alert);
      }
      alertHistory.push(alert);
    });
    
    logger.info('Loaded alerts from database', { 
      activeCount: activeAlerts.size, 
      historyCount: alertHistory.length 
    });
  } catch (error) {
    logger.error('Failed to load alerts from database', error);
  }
};

// Initialize database on module load
initDatabase();
loadAlertsFromDb();

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
      
      const alertData: Alert = {
        id: alertId,
        name: alert.labels?.alertname || 'Unknown',
        severity,
        status,
        miner: alert.labels?.miner || alert.labels?.name,
        summary: alert.annotations?.summary || '',
        description: alert.annotations?.description || '',
        firedAt: new Date(alert.startsAt).getTime(),
        resolvedAt: status === 'resolved' ? new Date(alert.endsAt).getTime() : undefined,
        labels: alert.labels || {},
        annotations: alert.annotations || {},
      };

      if (status === 'firing') {
        activeAlerts.set(alertId, alertData);
        
        // Send to Telegram
        await sendAlert({
          severity: alertData.severity,
          title: alertData.summary,
          description: alertData.description,
          miner: alertData.miner,
        });
        
        logger.info(`Alert fired: ${alertData.name} - ${alertData.summary}`);
      } else if (status === 'resolved') {
        activeAlerts.delete(alertId);
        alertData.resolvedAt = Date.now();
        
        // Send resolution notification for all severities
        // Use different emojis based on original severity
        const resolvedEmoji = severity === 'critical' ? '✅' : severity === 'warning' ? '✔️' : 'ℹ️';
        await sendAlert({
          severity: 'info',
          title: `${resolvedEmoji} Resolved: ${alertData.name}`,
          description: alertData.summary,
          miner: alertData.miner,
        });
        
        logger.info(`Alert resolved: ${alertData.name} - ${alertData.summary}`);
      }

      // Add to history
      addToHistory(alertData);
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
 * Generate unique alert ID
 */
const generateAlertId = (alert: any): string => {
  const labels = alert.labels || {};
  const key = `${labels.alertname}_${labels.miner || labels.instance || 'unknown'}`;
  return key;
};

/**
 * Add alert to history (in-memory and database)
 */
const addToHistory = (alert: Alert): void => {
  alertHistory.unshift(alert);
  
  // Keep history size limited
  if (alertHistory.length > MAX_HISTORY_SIZE) {
    alertHistory.splice(MAX_HISTORY_SIZE);
  }
  
  // Persist to database
  saveAlertToDb(alert);
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
