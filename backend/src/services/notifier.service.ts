/**
 * Alert notification channel.
 *
 * Why this exists: alert delivery on this project was dead for nine months and
 * nothing said so. Alertmanager posted to a route that returned 404, and on the
 * backend side `sendSmartAlert()` swallows send errors and returns `void`
 * whether or not anything left the building -- while the caller logged
 * "(sent to all users)" unconditionally. Two independent ways to be silent, and
 * both of them looked like success.
 *
 * So this module's contract is not "send a message". It is "say what happened":
 * every call returns an outcome, and the outcome is counted. A channel that
 * cannot deliver is a legitimate configuration -- Telegram is blocked at this
 * site and there is nothing to fix on our side -- but it must never be
 * indistinguishable from one that can.
 *
 * Three outcomes, deliberately:
 *   delivered    - the channel confirmed the send.
 *   not_delivered- the channel is a stub or disabled; nothing was sent, on purpose.
 *   unverified   - the channel returned without error but cannot confirm anything.
 *
 * `unverified` is not hedging. `sendSmartAlert()` catches its own transport
 * errors, so "it returned" carries no information about delivery -- the project
 * learned that the hard way when a watchdog spent a night armed on an RCI call
 * that returned 200 and did nothing. Reporting that as `delivered` would be a
 * fabricated measurement. It can be narrowed to delivered/failed when
 * telegram.service is decomposed (Phase 3.4).
 */

import axios from 'axios';

import logger from '../utils/logger';

export type NotifyOutcome = 'delivered' | 'not_delivered' | 'unverified';

export type NotifyChannel = 'telegram' | 'ntfy' | 'log' | 'none';

export interface NotifyRequest {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  miner?: string;
  recipients?: string[];
  isFarmWide?: boolean;
}

export interface NotifyResult {
  channel: NotifyChannel;
  outcome: NotifyOutcome;
  /** Why the outcome is what it is. Always populated for anything but `delivered`. */
  reason?: string;
}

const VALID_CHANNELS: NotifyChannel[] = ['telegram', 'ntfy', 'log', 'none'];

const counters = new Map<string, number>();

const count = (channel: NotifyChannel, outcome: NotifyOutcome): void => {
  const key = `${channel}|${outcome}`;
  counters.set(key, (counters.get(key) || 0) + 1);
};

/**
 * Counted notification attempts, keyed by channel and outcome.
 * Exposed on /metrics as alert_notifications_total{channel,outcome}.
 */
export const getNotificationMetrics = (): Array<{
  channel: string;
  outcome: string;
  count: number;
}> =>
  Array.from(counters.entries()).map(([key, value]) => {
    const [channel, outcome] = key.split('|');
    return { channel, outcome, count: value };
  });

/** Test seam: the counters are process-global, so tests must be able to clear them. */
export const resetNotificationMetrics = (): void => {
  counters.clear();
};

/**
 * The configured channel. Defaults to `telegram` so that installs where it works
 * are unaffected; this site sets ALERT_NOTIFY_CHANNEL=log because Telegram is
 * blocked upstream. An unrecognised value falls back to `log` loudly rather than
 * silently picking a channel nobody asked for.
 */
export const getNotifyChannel = (): NotifyChannel => {
  const raw = (process.env.ALERT_NOTIFY_CHANNEL || 'telegram').trim().toLowerCase();
  if ((VALID_CHANNELS as string[]).includes(raw)) {
    return raw as NotifyChannel;
  }
  logger.warn(
    `ALERT_NOTIFY_CHANNEL="${raw}" is not one of ${VALID_CHANNELS.join('/')}; using "log"`,
    { service: 'notifier' }
  );
  return 'log';
};

/**
 * ntfy priorities and tags per severity. 5 is ntfy's "max", which is what breaks
 * through a phone's do-not-disturb -- appropriate for a critical, wrong for the
 * rest.
 */
const NTFY_PRIORITY: Record<NotifyRequest['severity'], number> = {
  critical: 5,
  warning: 4,
  info: 3,
};

const NTFY_TAGS: Record<NotifyRequest['severity'], string[]> = {
  critical: ['rotating_light'],
  warning: ['warning'],
  info: ['information_source'],
};

/**
 * Publish to an ntfy topic.
 *
 * This is the first channel here that can report `delivered` without lying:
 * ntfy answers with a status code, unlike `sendSmartAlert()`, which swallows its
 * own transport errors and leaves `unverified` as the only honest outcome.
 *
 * Published as a JSON body rather than the X-Title/X-Message headers ntfy also
 * accepts: alert titles carry emoji and non-ASCII, and HTTP header values are
 * latin-1. A JSON body is UTF-8 and sidesteps the encoding question entirely.
 */
const sendViaNtfy = async (alert: NotifyRequest): Promise<NotifyResult> => {
  const topic = (process.env.NTFY_TOPIC || '').trim();
  if (!topic) {
    // Fail visibly. A channel selected but unconfigured must not look like one
    // that delivered -- the whole point of this module.
    const reason = 'ALERT_NOTIFY_CHANNEL=ntfy but NTFY_TOPIC is unset';
    logger.warn('ALERT NOT DELIVERED', {
      service: 'notifier',
      reason,
      severity: alert.severity,
      title: alert.title,
      miner: alert.miner,
    });
    return { channel: 'ntfy', outcome: 'not_delivered', reason };
  }

  const base = (process.env.NTFY_URL || 'https://ntfy.sh').trim().replace(/\/+$/, '');
  const body = {
    topic,
    title: alert.title,
    message: alert.miner ? `${alert.description}\n\nMiner: ${alert.miner}` : alert.description,
    priority: NTFY_PRIORITY[alert.severity] ?? 3,
    tags: NTFY_TAGS[alert.severity] ?? [],
  };

  try {
    const response = await axios.post(base, body, {
      // The uplink here is a metered 4G link that has measured multi-second
      // round-trips even when healthy; a short timeout would report a working
      // channel as broken.
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
      // Inspect the status rather than letting axios throw, so a rejection
      // carries the code instead of a generic message.
      validateStatus: () => true,
    });

    if (response.status >= 200 && response.status < 300) {
      return { channel: 'ntfy', outcome: 'delivered' };
    }

    const reason = `ntfy returned HTTP ${response.status}`;
    logger.warn('ALERT NOT DELIVERED', {
      service: 'notifier',
      reason,
      severity: alert.severity,
      title: alert.title,
      miner: alert.miner,
    });
    return { channel: 'ntfy', outcome: 'not_delivered', reason };
  } catch (error) {
    const reason = `ntfy request failed: ${(error as Error)?.message || 'unknown error'}`;
    logger.warn('ALERT NOT DELIVERED', {
      service: 'notifier',
      reason,
      severity: alert.severity,
      title: alert.title,
      miner: alert.miner,
    });
    return { channel: 'ntfy', outcome: 'not_delivered', reason };
  }
};

/** One line per alert, at WARN, carrying the whole payload so Loki can show it. */
const logStub = (alert: NotifyRequest, reason: string): NotifyResult => {
  logger.warn('ALERT NOT DELIVERED', {
    service: 'notifier',
    reason,
    severity: alert.severity,
    title: alert.title,
    description: alert.description,
    miner: alert.miner,
    isFarmWide: alert.isFarmWide,
    recipientCount: alert.recipients?.length || 0,
  });
  return { channel: 'log', outcome: 'not_delivered', reason };
};

/**
 * Deliver an alert over the configured channel and report what happened.
 * Never throws: a broken notifier must not cost us the alert record, and
 * Alertmanager must not be made to retry a webhook we already processed.
 */
export const notifyAlert = async (alert: NotifyRequest): Promise<NotifyResult> => {
  const channel = getNotifyChannel();
  let result: NotifyResult;

  try {
    if (channel === 'none') {
      result = {
        channel: 'none',
        outcome: 'not_delivered',
        reason: 'ALERT_NOTIFY_CHANNEL=none',
      };
    } else if (channel === 'log') {
      result = logStub(alert, 'ALERT_NOTIFY_CHANNEL=log (stub channel)');
    } else if (channel === 'ntfy') {
      result = await sendViaNtfy(alert);
    } else {
      // Lazy require: preserves the codebase's circular-import avoidance.
      const { sendSmartAlert } = require('./telegram.service');
      await sendSmartAlert({
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        miner: alert.miner,
        recipients: alert.recipients,
        isFarmWide: alert.isFarmWide,
      });
      result = {
        channel: 'telegram',
        outcome: 'unverified',
        reason: 'sendSmartAlert() swallows transport errors; delivery cannot be confirmed',
      };
    }
  } catch (error) {
    logger.error('Notification channel threw; the alert record is unaffected', {
      service: 'notifier',
      channel,
      error,
    });
    result = { channel, outcome: 'not_delivered', reason: 'channel threw' };
  }

  count(result.channel, result.outcome);
  return result;
};
