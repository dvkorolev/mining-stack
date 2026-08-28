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


// --- ntfy (DMI-78) ----------------------------------------------------------
// Until this channel existed, no alert could reach a human from this site:
// telegram is blocked upstream and the other two channels are stubs by design.

const axiosModule = require('axios');

/**
 * Swap axios.post for the duration of a test. The compiled service calls
 * `axios_1.default.post`, and `__importDefault` resolves that to this same
 * object, so patching here is what the service actually sees. Patched on both
 * the module and its `.default` in case that ever stops being true.
 */
const withPost = async (impl, fn) => {
  // axios is a *function* with properties, not a plain object -- filtering on
  // typeof 'object' silently patches nothing and lets the test hit the network
  // for real. It did exactly that once; hence the assertion below.
  const targets = [axiosModule, axiosModule.default].filter(
    (t) => t && (typeof t === 'object' || typeof t === 'function')
  );
  assert.ok(targets.length > 0, 'no axios object to patch - the test would hit the network');
  const originals = targets.map((t) => t.post);
  const calls = [];
  targets.forEach((t) => {
    t.post = async (url, body, config) => {
      calls.push({ url, body, config });
      return impl();
    };
  });
  try {
    return await fn(calls);
  } finally {
    targets.forEach((t, i) => {
      t.post = originals[i];
    });
  }
};

const withEnv = async (vars, fn) => {
  const previous = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

// The whole reason for adding this channel: it can confirm, so it is allowed to
// say `delivered` -- the only channel here that may.
test('ntfy reports delivered on a 2xx', async () => {
  await withChannel('ntfy', async () => {
    await withEnv({ NTFY_TOPIC: 'test-topic', NTFY_URL: undefined }, async () => {
      await withPost(
        () => ({ status: 200 }),
        async (calls) => {
          const result = await notifier.notifyAlert(alert);
          assert.strictEqual(result.channel, 'ntfy');
          assert.strictEqual(result.outcome, 'delivered');
          assert.strictEqual(calls.length, 1);
          assert.strictEqual(calls[0].url, 'https://ntfy.sh');
          assert.strictEqual(calls[0].body.topic, 'test-topic');
          assert.strictEqual(calls[0].body.priority, 5, 'critical must use ntfy max priority');
          assert.match(calls[0].body.message, /002/, 'the miner belongs in the message');
        }
      );
    });
  });
});

// A channel selected but unconfigured is the exact shape of failure this module
// exists to prevent: it must not look like one that delivered.
test('ntfy without a topic fails visibly, and sends nothing', async () => {
  await withChannel('ntfy', async () => {
    await withEnv({ NTFY_TOPIC: undefined }, async () => {
      await withPost(
        () => ({ status: 200 }),
        async (calls) => {
          const result = await notifier.notifyAlert(alert);
          assert.strictEqual(result.outcome, 'not_delivered');
          assert.match(result.reason, /NTFY_TOPIC/);
          assert.strictEqual(calls.length, 0, 'nothing may be sent without a topic');
        }
      );
    });
  });
});

// A 2xx is the only evidence of delivery there is, so anything else is a
// non-delivery that must carry the code -- not a generic failure.
test('a non-2xx from ntfy is a non-delivery, and names the status', async () => {
  await withChannel('ntfy', async () => {
    await withEnv({ NTFY_TOPIC: 'test-topic' }, async () => {
      await withPost(
        () => ({ status: 429 }),
        async () => {
          const result = await notifier.notifyAlert(alert);
          assert.strictEqual(result.outcome, 'not_delivered');
          assert.match(result.reason, /429/);
        }
      );
    });
  });
});

test('a dead uplink is reported, not thrown', async () => {
  await withChannel('ntfy', async () => {
    await withEnv({ NTFY_TOPIC: 'test-topic' }, async () => {
      await withPost(
        () => {
          throw new Error('ETIMEDOUT');
        },
        async () => {
          const result = await notifier.notifyAlert(alert);
          assert.strictEqual(result.channel, 'ntfy');
          assert.strictEqual(result.outcome, 'not_delivered');
          assert.match(result.reason, /ETIMEDOUT/);
        }
      );
    });
  });
});

test('a self-hosted NTFY_URL is honoured, trailing slash and all', async () => {
  await withChannel('ntfy', async () => {
    await withEnv({ NTFY_TOPIC: 'test-topic', NTFY_URL: 'https://ntfy.example.com/' }, async () => {
      await withPost(
        () => ({ status: 200 }),
        async (calls) => {
          await notifier.notifyAlert(alert);
          assert.strictEqual(calls[0].url, 'https://ntfy.example.com');
        }
      );
    });
  });
});

test('severity maps to distinct ntfy priorities', async () => {
  await withChannel('ntfy', async () => {
    await withEnv({ NTFY_TOPIC: 'test-topic', NTFY_URL: undefined }, async () => {
      await withPost(
        () => ({ status: 200 }),
        async (calls) => {
          for (const severity of ['critical', 'warning', 'info']) {
            await notifier.notifyAlert({ ...alert, severity });
          }
          assert.deepStrictEqual(
            calls.map((c) => c.body.priority),
            [5, 4, 3]
          );
        }
      );
    });
  });
});


// --- suppression policy (DMI-79) --------------------------------------------
// This farm runs old ASICs to failure: 38 of the 41 alerts standing on
// 2026-08-28 were chronic per-miner conditions nobody intends to act on. A
// channel that opens with that volume gets muted, which is the original silence
// wearing the appearance of alerting.

test('an excluded component is not notified, and nothing is sent', async () => {
  await withChannel('ntfy', async () => {
    await withEnv(
      { NTFY_TOPIC: 'test-topic', ALERT_NOTIFY_EXCLUDE_COMPONENTS: 'miner' },
      async () => {
        await withPost(
          () => ({ status: 200 }),
          async (calls) => {
            const result = await notifier.notifyAlert({ ...alert, component: 'miner' });
            assert.strictEqual(result.outcome, 'not_delivered');
            assert.match(result.reason, /component=miner/);
            assert.strictEqual(calls.length, 0, 'a suppressed alert must not be sent');
          }
        );
      }
    );
  });
});

// The point of excluding one component is that the others still get through --
// a policy that silences everything is just `none` with extra steps.
test('a component outside the exclusion list still delivers', async () => {
  await withChannel('ntfy', async () => {
    await withEnv(
      { NTFY_TOPIC: 'test-topic', ALERT_NOTIFY_EXCLUDE_COMPONENTS: 'miner' },
      async () => {
        await withPost(
          () => ({ status: 200 }),
          async (calls) => {
            const result = await notifier.notifyAlert({ ...alert, component: 'farm' });
            assert.strictEqual(result.outcome, 'delivered');
            assert.strictEqual(calls.length, 1);
          }
        );
      }
    );
  });
});

// Empty means "notify about everything": an install that never sets this must
// behave exactly as it did before the policy existed.
test('an unset policy suppresses nothing', async () => {
  await withChannel('ntfy', async () => {
    await withEnv(
      { NTFY_TOPIC: 'test-topic', ALERT_NOTIFY_EXCLUDE_COMPONENTS: undefined },
      async () => {
        await withPost(
          () => ({ status: 200 }),
          async (calls) => {
            const result = await notifier.notifyAlert({ ...alert, component: 'miner' });
            assert.strictEqual(result.outcome, 'delivered');
            assert.strictEqual(calls.length, 1);
          }
        );
      }
    );
  });
});

test('the list is comma-separated and case-insensitive, with stray spaces tolerated', async () => {
  await withChannel('ntfy', async () => {
    await withEnv(
      { NTFY_TOPIC: 'test-topic', ALERT_NOTIFY_EXCLUDE_COMPONENTS: ' Miner , LOGGING ' },
      async () => {
        await withPost(
          () => ({ status: 200 }),
          async (calls) => {
            assert.strictEqual(
              (await notifier.notifyAlert({ ...alert, component: 'MINER' })).outcome,
              'not_delivered'
            );
            assert.strictEqual(
              (await notifier.notifyAlert({ ...alert, component: 'logging' })).outcome,
              'not_delivered'
            );
            assert.strictEqual(
              (await notifier.notifyAlert({ ...alert, component: 'uplink' })).outcome,
              'delivered'
            );
            assert.strictEqual(calls.length, 1, 'only the uplink alert may be sent');
          }
        );
      }
    );
  });
});

// An alert carrying no component at all must not be caught by the policy --
// silence by accident is the thing this module exists to prevent.
test('an alert with no component is never suppressed', async () => {
  await withChannel('ntfy', async () => {
    await withEnv(
      { NTFY_TOPIC: 'test-topic', ALERT_NOTIFY_EXCLUDE_COMPONENTS: 'miner' },
      async () => {
        await withPost(
          () => ({ status: 200 }),
          async (calls) => {
            const result = await notifier.notifyAlert({ ...alert, component: undefined });
            assert.strictEqual(result.outcome, 'delivered');
            assert.strictEqual(calls.length, 1);
          }
        );
      }
    );
  });
});

// A deliberate non-delivery still has to be visible as one.
test('suppression is counted, not silent', async () => {
  await withChannel('ntfy', async () => {
    await withEnv(
      { NTFY_TOPIC: 'test-topic', ALERT_NOTIFY_EXCLUDE_COMPONENTS: 'miner' },
      async () => {
        notifier.resetNotificationMetrics();
        await notifier.notifyAlert({ ...alert, component: 'miner' });
        assert.deepStrictEqual(notifier.getNotificationMetrics(), [
          { channel: 'ntfy', outcome: 'not_delivered', count: 1 },
        ]);
      }
    );
  });
});

// A rule whose component is otherwise worth notifying about, but whose specific
// condition is accepted -- FarmMultipleMinersOffline on a site with five
// machines permanently absent from a stale inventory.
test('a named rule can be suppressed even when its component is not', async () => {
  await withChannel('ntfy', async () => {
    await withEnv(
      {
        NTFY_TOPIC: 'test-topic',
        ALERT_NOTIFY_EXCLUDE_COMPONENTS: 'miner',
        ALERT_NOTIFY_EXCLUDE_ALERTS: 'FarmMultipleMinersOffline',
      },
      async () => {
        await withPost(
          () => ({ status: 200 }),
          async (calls) => {
            const blocked = await notifier.notifyAlert({
              ...alert,
              component: 'farm',
              alertName: 'FarmMultipleMinersOffline',
            });
            assert.strictEqual(blocked.outcome, 'not_delivered');
            assert.match(blocked.reason, /alertname=FarmMultipleMinersOffline/);

            // The rest of the farm category must still get through, or the
            // exclusion has silenced more than it was asked to.
            const allowed = await notifier.notifyAlert({
              ...alert,
              component: 'farm',
              alertName: 'FarmHashrateDropSHA256',
            });
            assert.strictEqual(allowed.outcome, 'delivered');
            assert.strictEqual(calls.length, 1);
          }
        );
      }
    );
  });
});
