const { test } = require('node:test');
const assert = require('node:assert');
const { generateRandomError } = require('../dist/services/mining/simulation.js');

// generateRandomError is randomized, but two branches are deterministic:
// a high temperature / high rejection error is pushed first and the function
// returns errors[0], so those codes always win regardless of the random tail.

test('temperature over 85C always yields HIGH_TEMP first', () => {
  for (let i = 0; i < 50; i++) {
    const err = generateRandomError(90, 0);
    assert.ok(err, 'expected a non-null error');
    assert.strictEqual(err.code, 'HIGH_TEMP');
    assert.strictEqual(err.severity, 'critical');
    assert.strictEqual(err.details.temperature, '90.0');
  }
});

test('high temperature outranks high rejection (temp pushed first)', () => {
  const err = generateRandomError(100, 20);
  assert.strictEqual(err.code, 'HIGH_TEMP');
});

test('high rejection without high temp yields HIGH_REJECTION first', () => {
  for (let i = 0; i < 50; i++) {
    const err = generateRandomError(50, 10);
    assert.strictEqual(err.code, 'HIGH_REJECTION');
    assert.strictEqual(err.details.rejectionRate, '10.00');
  }
});

test('nominal temp/rejection still returns a known random error (never null)', () => {
  const known = new Set(['FAN_FAILURE', 'CHIP_ERROR', 'NETWORK_ERROR', 'POWER_ISSUE']);
  for (let i = 0; i < 100; i++) {
    const err = generateRandomError(50, 0);
    assert.ok(err, 'expected a non-null error');
    assert.ok(known.has(err.code), `unexpected code ${err.code}`);
  }
});
