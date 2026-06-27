const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { AlertRuleRepository } = require('../dist/db/repositories/alert-rule.repository.js');

function freshRepo() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE, display_name TEXT, description TEXT, rule_group TEXT,
      severity TEXT, component TEXT, expr TEXT, for_duration TEXT,
      summary_template TEXT, description_template TEXT, scope TEXT,
      target_miner_ip TEXT, target_owner TEXT, enabled INTEGER, is_system INTEGER,
      created_by TEXT, created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE alert_rule_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER, rule_name TEXT, action TEXT, changed_by TEXT, changes TEXT,
      timestamp INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
  return { db, repo: new AlertRuleRepository(db) };
}

function rule(overrides = {}) {
  return {
    name: 'high_temp',
    display_name: 'High Temperature',
    rule_group: 'temperature',
    severity: 'warning',
    component: 'miner',
    expr: 'miner_temp_max_c > 80',
    for_duration: '5m',
    summary_template: 'Hot',
    scope: 'global',
    enabled: 1,
    is_system: 0,
    ...overrides,
  };
}

test('insertAlertRule returns an id, logs created history, and is readable', () => {
  const { db, repo } = freshRepo();
  const id = repo.insertAlertRule(rule({ created_by: 'admin' }));
  assert.ok(id > 0);
  assert.strictEqual(repo.getAlertRuleById(id).name, 'high_temp');
  assert.strictEqual(repo.getAlertRuleByName('high_temp').id, id);

  const history = repo.getAlertRuleHistory(id);
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].action, 'created');
  db.close();
});

test('updateAlertRule applies dynamic fields and logs history', () => {
  const { db, repo } = freshRepo();
  const id = repo.insertAlertRule(rule());
  const ok = repo.updateAlertRule(id, { severity: 'critical', expr: 'x > 90' }, 'admin');
  assert.strictEqual(ok, true);
  const updated = repo.getAlertRuleById(id);
  assert.strictEqual(updated.severity, 'critical');
  assert.strictEqual(updated.expr, 'x > 90');
  // history rows can share a same-second timestamp, so assert membership not position
  assert.ok(repo.getAlertRuleHistory(id).some(h => h.action === 'updated'));
  db.close();
});

test('updateAlertRule returns false for missing rule or empty updates', () => {
  const { db, repo } = freshRepo();
  assert.strictEqual(repo.updateAlertRule(999, { severity: 'critical' }), false);
  const id = repo.insertAlertRule(rule());
  assert.strictEqual(repo.updateAlertRule(id, {}), false);
  db.close();
});

test('toggleAlertRule flips enabled and logs enabled/disabled', () => {
  const { db, repo } = freshRepo();
  const id = repo.insertAlertRule(rule({ enabled: 1 }));
  repo.toggleAlertRule(id, false, 'admin');
  assert.strictEqual(repo.getAlertRuleById(id).enabled, 0);
  assert.ok(repo.getAlertRuleHistory(id).some(h => h.action === 'disabled'));
  db.close();
});

test('deleteAlertRule removes a non-system rule but refuses system rules', () => {
  const { db, repo } = freshRepo();
  const userRule = repo.insertAlertRule(rule({ name: 'r1' }));
  const sysRule = repo.insertAlertRule(rule({ name: 'r2', is_system: 1 }));

  assert.strictEqual(repo.deleteAlertRule(userRule, 'admin'), true);
  assert.strictEqual(repo.getAlertRuleById(userRule), null);
  assert.throws(() => repo.deleteAlertRule(sysRule, 'admin'), /Cannot delete system alert rules/);
  assert.strictEqual(repo.deleteAlertRule(999), false);
  db.close();
});

test('getAllAlertRules applies enabled/severity filters', () => {
  const { db, repo } = freshRepo();
  repo.insertAlertRule(rule({ name: 'a', severity: 'warning', enabled: 1 }));
  repo.insertAlertRule(rule({ name: 'b', severity: 'critical', enabled: 0 }));

  assert.strictEqual(repo.getAllAlertRules().length, 2);
  assert.deepStrictEqual(repo.getAllAlertRules({ enabled: true }).map(r => r.name), ['a']);
  assert.deepStrictEqual(repo.getAllAlertRules({ severity: 'critical' }).map(r => r.name), ['b']);
  db.close();
});
