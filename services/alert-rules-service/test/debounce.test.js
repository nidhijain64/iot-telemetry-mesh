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

test('fires again once the cooldown has elapsed', async () => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] });


  assert.strictEqual(await shouldFire('dev-6', 'high-temperature'), true);
  jest.setSystemTime(Date.now() + 59000);
  assert.strictEqual(await shouldFire('dev-6', 'high-temperature'), false, 'still inside cooldown');
  jest.setSystemTime(Date.now() + 2000);
  assert.strictEqual(await shouldFire('dev-6', 'high-temperature'), true, 'cooldown elapsed');
});

afterEach(() => jest.useRealTimers());
