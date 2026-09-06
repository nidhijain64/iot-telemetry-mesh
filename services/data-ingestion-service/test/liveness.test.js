const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

process.env.LIVENESS_THROTTLE_MS = '30000';
process.env.INTERNAL_SERVICE_KEY = 'test-service-key';
process.env.DEVICE_REGISTRY_URL = 'http://registry.test:3002';
const { reportSeen, shouldReport, _resetThrottle } = require('../src/liveness');

// Captures the calls the reporter would make, so the throttle can be observed
// without a registry on the other end.
function mockPost(t, impl = async () => ({ data: {} })) {
  const calls = [];
  t.mock.method(axios, 'post', async (url, body, config) => {
    calls.push({ url, config });
    return impl();
  });
  return calls;
}

test.beforeEach(() => _resetThrottle());

test('reports a device that has not been seen before', async (t) => {
  const calls = mockPost(t);
  assert.strictEqual(await reportSeen('sim-01'), true);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /\/api\/devices\/sim-01\/seen$/);
});

test('authenticates with the shared service key, not a user JWT', async (t) => {
  const calls = mockPost(t);
  await reportSeen('sim-01');
  assert.strictEqual(calls[0].config.headers['x-service-key'], 'test-service-key');
  assert.ok(!calls[0].config.headers.Authorization);
});

test('throttles repeat publishes from the same device', async (t) => {
  const calls = mockPost(t);
  for (let i = 0; i < 10; i++) await reportSeen('sim-01');
  assert.strictEqual(calls.length, 1, 'ten publishes should produce one registry call');
});

test('throttles each device independently', async (t) => {
  const calls = mockPost(t);
  await reportSeen('sim-01');
  await reportSeen('sim-02');
  assert.strictEqual(calls.length, 2);
});

test('reports again once the throttle window has passed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  t.after(() => t.mock.timers.reset());
  const calls = mockPost(t);

  await reportSeen('sim-01');
  t.mock.timers.tick(29000);
  await reportSeen('sim-01');
  assert.strictEqual(calls.length, 1, 'still inside the throttle window');

  t.mock.timers.tick(2000);
  await reportSeen('sim-01');
  assert.strictEqual(calls.length, 2, 'window elapsed, reports again');
});

test('a failed report is retried on the next publish instead of waiting out the window', async (t) => {
  let failNext = true;
  const calls = mockPost(t, async () => {
    if (failNext) {
      failNext = false;
      throw new Error('registry unreachable');
    }
    return { data: {} };
  });

  assert.strictEqual(await reportSeen('sim-01'), false, 'first attempt fails');
  assert.strictEqual(await reportSeen('sim-01'), true, 'next publish retries immediately');
  assert.strictEqual(calls.length, 2);
});

test('a successful report does not retry until the window passes', async (t) => {
  const calls = mockPost(t);
  await reportSeen('sim-01');
  await reportSeen('sim-01');
  assert.strictEqual(calls.length, 1);
});

test('ignores a missing deviceId rather than calling with undefined in the URL', async (t) => {
  const calls = mockPost(t);
  assert.strictEqual(await reportSeen(undefined), false);
  assert.strictEqual(await reportSeen(''), false);
  assert.strictEqual(calls.length, 0);
});

test('shouldReport is true for an unseen device and false right after a report', async (t) => {
  mockPost(t);
  assert.strictEqual(shouldReport('sim-99'), true);
  await reportSeen('sim-99');
  assert.strictEqual(shouldReport('sim-99'), false);
});
