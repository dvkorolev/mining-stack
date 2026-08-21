const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-notify-'));

const notifier = require('../dist/services/notifier.service.js');

const alert = {
  severity: 'critical',
  title: 'Miner 002 board 2 chips at 109.5C',
  description: 'chip temperature above 105C for 5m',
  miner: '002',
  recipients: ['123'],
  isFarmWide: false,
};

const withChannel = async (value, fn) => {
  const previous = process.env.ALERT_NOTIFY_CHANNEL;
  if (value === undefined) delete process.env.ALERT_NOTIFY_CHANNEL;
  else process.env.ALERT_NOTIFY_CHANNEL = value;
  notifier.resetNotificationMetrics();
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.ALERT_NOTIFY_CHANNEL;
    else process.env.ALERT_NOTIFY_CHANNEL = previous;
  }
};

// The point of the whole module: a stub must not read as a delivery. This is the
// regression that hid a nine-month outage of the alerting path.
test('the log stub reports not_delivered, never success', async () => {
  await withChannel('log', async () => {
    const result = await notifier.notifyAlert(alert);
    assert.strictEqual(result.channel, 'log');
    assert.strictEqual(result.outcome, 'not_delivered');
    assert.ok(result.reason, 'a non-delivery must carry a reason');
  });
});

test('an explicitly silent channel is still counted', async () => {
  await withChannel('none', async () => {
    const result = await notifier.notifyAlert(alert);
    assert.strictEqual(result.outcome, 'not_delivered');
    const m = notifier.getNotificationMetrics();
    assert.deepStrictEqual(m, [{ channel: 'none', outcome: 'not_delivered', count: 1 }]);
  });
});

// sendSmartAlert() catches its own transport errors and returns void either way,
// so "it returned" is not evidence of delivery. Reporting `delivered` here would
// be exactly the fabricated measurement this project keeps getting caught by.
test('telegram reports unverified, not delivered', async () => {
  await withChannel('telegram', async () => {
    const result = await notifier.notifyAlert(alert);
    assert.strictEqual(result.channel, 'telegram');
    assert.strictEqual(result.outcome, 'unverified');
    assert.notStrictEqual(result.outcome, 'delivered');
  });
});

test('an unrecognised channel falls back to the visible stub, not to sending', async () => {
  await withChannel('smoke-signals', async () => {
    const result = await notifier.notifyAlert(alert);
    assert.strictEqual(result.channel, 'log');
    assert.strictEqual(result.outcome, 'not_delivered');
  });
});

test('the default channel is telegram, so working installs are unaffected', async () => {
  await withChannel(undefined, async () => {
    assert.strictEqual(notifier.getNotifyChannel(), 'telegram');
  });
});

// A notifier that throws must cost us the notification, never the alert record --
// and must not make Alertmanager retry a webhook the backend already processed.
test('notifyAlert never throws, whatever the channel does', async () => {
  await withChannel('telegram', async () => {
    const telegramPath = require.resolve('../dist/services/telegram.service.js');
    const original = require.cache[telegramPath];
    require.cache[telegramPath] = {
      id: telegramPath,
      filename: telegramPath,
      loaded: true,
      exports: {
        sendSmartAlert: async () => {
          throw new Error('channel exploded');
        },
      },
    };
    try {
      const result = await notifier.notifyAlert(alert);
      assert.strictEqual(result.outcome, 'not_delivered');
      assert.strictEqual(result.reason, 'channel threw');
    } finally {
      if (original) require.cache[telegramPath] = original;
      else delete require.cache[telegramPath];
    }
  });
});

test('outcomes accumulate per channel and outcome', async () => {
  await withChannel('log', async () => {
    await notifier.notifyAlert(alert);
    await notifier.notifyAlert(alert);
    const m = notifier.getNotificationMetrics();
    assert.deepStrictEqual(m, [{ channel: 'log', outcome: 'not_delivered', count: 2 }]);
  });
});
