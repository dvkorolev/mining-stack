/**
 * DMI-71 regression: one alert id per alert instance.
 *
 * The previous scheme keyed on `alertname_(miner || instance)_startsAt`. No mining
 * rule sets a `miner` label and `instance` is the scrape target — identical for the
 * whole fleet — so every per-miner alert of one name collapsed into a single id and
 * all but the first were silently discarded.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-alertid-'));
process.env.ALERT_NOTIFY_CHANNEL = 'none';

// Stub the two modules processAlertWebhook pulls in lazily, before it can load them.
const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

stub('../dist/services/telegram.service.js', {
  getBotStatus: () => ({ chatIds: ['999'] }),
  sendAlert: async () => {},
  sendSmartAlert: async () => {},
});

const notified = [];
stub('../dist/services/notifier.service.js', {
  notifyAlert: async (a) => {
    notified.push(a);
    return { channel: 'none', outcome: 'not_delivered' };
  },
});

const alertService = require('../dist/services/alert.service.js');

// The real fleet shape: same alertname, same instance, no `miner` label, one
// evaluation cycle so one shared startsAt. Only `name`/`ip` differ.
const FIRED_AT = '2026-08-20T21:15:54.000Z';
const fleetAlert = (name, ip) => ({
  status: 'firing',
  startsAt: FIRED_AT,
  labels: {
    alertname: 'MinerErrors',
    severity: 'warning',
    component: 'miner',
    instance: 'python-scheduler:8000',
    name,
    ip,
  },
  annotations: { summary: `Miner ${name} reporting errors`, description: `${name} has errors` },
});

const FLEET = [
  ['whatsminer-058', '192.168.2.58'],
  ['m50n', '192.168.2.137'],
  ['m51', '192.168.2.52'],
  ['m302', '192.168.2.87'],
  ['004', '192.168.2.121'],
];

test('a batch of alerts differing only in miner produces one record each', async () => {
  notified.length = 0;
  await alertService.processAlertWebhook({ alerts: FLEET.map(([n, ip]) => fleetAlert(n, ip)) });

  const active = alertService.getActiveAlerts().filter(a => a.name === 'MinerErrors');
  assert.strictEqual(active.length, FLEET.length,
    `expected ${FLEET.length} active alerts, got ${active.length} — ids collapsed`);

  const ids = new Set(active.map(a => a.id));
  assert.strictEqual(ids.size, FLEET.length, 'alert ids must be distinct per miner');

  const miners = new Set(active.map(a => a.miner));
  assert.deepStrictEqual([...miners].sort(), FLEET.map(([n]) => n).sort());
});

test('every alert in the batch notifies — not just the first', async () => {
  notified.length = 0;
  await alertService.processAlertWebhook({ alerts: FLEET.map(([n, ip]) => fleetAlert(n, ip)) });
  // Already active from the previous test: a re-delivery must NOT re-notify.
  assert.strictEqual(notified.length, 0, 'duplicate webhook delivery must not re-notify');

  const fresh = [['m52', '192.168.2.130'], ['001', '192.168.2.65']];
  await alertService.processAlertWebhook({ alerts: fresh.map(([n, ip]) => fleetAlert(n, ip)) });
  assert.strictEqual(notified.length, fresh.length,
    `expected ${fresh.length} notifications, got ${notified.length}`);
});

test('resolving one miner leaves the others active', async () => {
  const before = alertService.getActiveAlerts().filter(a => a.name === 'MinerErrors').length;

  const [name, ip] = FLEET[0];
  await alertService.processAlertWebhook({
    alerts: [{ ...fleetAlert(name, ip), status: 'resolved', endsAt: '2026-08-20T21:40:00.000Z' }],
  });

  const after = alertService.getActiveAlerts().filter(a => a.name === 'MinerErrors');
  assert.strictEqual(after.length, before - 1, 'exactly one alert should have resolved');
  assert.ok(!after.some(a => a.miner === name), `${name} should no longer be active`);
});

test('ids are versioned so a pre-v2 id is recognisable', () => {
  const active = alertService.getActiveAlerts();
  assert.ok(active.length > 0);
  for (const a of active) {
    assert.ok(a.id.startsWith('v2_'), `id must carry the scheme prefix: ${a.id}`);
  }
});

test('a farm-wide alert with no miner label still gets its own id', async () => {
  notified.length = 0;
  await alertService.processAlertWebhook({
    alerts: [{
      status: 'firing',
      startsAt: FIRED_AT,
      labels: { alertname: 'FarmMultipleMinersOffline', severity: 'critical', instance: 'python-scheduler:8000' },
      annotations: { summary: 'Multiple miners offline', description: '5 offline' },
    }],
  });
  const farm = alertService.getActiveAlerts().filter(a => a.name === 'FarmMultipleMinersOffline');
  assert.strictEqual(farm.length, 1);
  assert.strictEqual(notified.length, 1);
});
