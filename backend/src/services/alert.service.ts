/**
 * Alert Service
 * 
 * Handles alert management and integration with Alertmanager
 * - Receives webhooks from Alertmanager
 * - Forwards alerts to Telegram
 * - Stores alert history
 * 
 * @module services/alert
 */

import { logger } from '../utils/logger';
import { sendAlert } from './telegram.service';

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
        
        // Optionally send resolution notification
        if (severity === 'critical') {
          await sendAlert({
            severity: 'info',
            title: `✅ Resolved: ${alertData.name}`,
            description: alertData.summary,
            miner: alertData.miner,
          });
        }
        
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
 * Add alert to history
 */
const addToHistory = (alert: Alert): void => {
  alertHistory.unshift(alert);
  
  // Keep history size limited
  if (alertHistory.length > MAX_HISTORY_SIZE) {
    alertHistory.splice(MAX_HISTORY_SIZE);
  }
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
