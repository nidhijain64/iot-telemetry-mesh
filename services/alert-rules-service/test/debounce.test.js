const test = require('node:test');
const assert = require('node:assert');

process.env.ALERT_COOLDOWN_MS = '60000';
const { shouldFire } = require('../src/detectors/debounce');

test('fires the first time an alert type is seen for a device', async () => {
  assert.strictEqual(await shouldFire('dev-1', 'high-temperature'), true);
});

test('suppresses a repeat of the same type within the cooldown', async () => {
  await shouldFire('dev-2', 'low-battery');
  assert.strictEqual(await shouldFire('dev-2', 'low-battery'), false);
  assert.strictEqual(await shouldFire('dev-2', 'low-battery'), false);
});

test('tracks each alert type independently', async () => {
  await shouldFire('dev-3', 'high-temperature');
  assert.strictEqual(await shouldFire('dev-3', 'low-battery'), true);
});

test('tracks each device independently', async () => {
  await shouldFire('dev-4', 'high-temperature');
  assert.strictEqual(await shouldFire('dev-5', 'high-temperature'), true);
});

test('fires again once the cooldown has elapsed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  t.after(() => t.mock.timers.reset());

  assert.strictEqual(await shouldFire('dev-6', 'high-temperature'), true);
  t.mock.timers.tick(59000);
  assert.strictEqual(await shouldFire('dev-6', 'high-temperature'), false, 'still inside cooldown');
  t.mock.timers.tick(2000);
  assert.strictEqual(await shouldFire('dev-6', 'high-temperature'), true, 'cooldown elapsed');
});
