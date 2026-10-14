const assert = require('node:assert');
const axios = require('axios');

process.env.LIVENESS_THROTTLE_MS = '30000';
process.env.INTERNAL_SERVICE_KEY = 'test-service-key';
process.env.DEVICE_REGISTRY_URL = 'http://registry.test:3002';
const { reportSeen, shouldReport, _resetThrottle } = require('../src/liveness');

// Captures the calls the reporter would make, so the throttle can be observed
// without a registry on the other end.
function mockPost(impl = async () => ({ data: {} })) {
  const calls = [];
  jest.spyOn(axios, 'post').mockImplementation(async (url, body, config) => {
    calls.push({ url, config });
    return impl();
  });
  return calls;
}

beforeEach(() => _resetThrottle());

test('reports a device that has not been seen before', async () => {
  const calls = mockPost();
  assert.strictEqual(await reportSeen('sim-01'), true);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /\/api\/devices\/sim-01\/seen$/);
});

test('authenticates with the shared service key, not a user JWT', async () => {
  const calls = mockPost();
  await reportSeen('sim-01');
  assert.strictEqual(calls[0].config.headers['x-service-key'], 'test-service-key');
  assert.ok(!calls[0].config.headers.Authorization);
});

test('throttles repeat publishes from the same device', async () => {
  const calls = mockPost();
  for (let i = 0; i < 10; i++) await reportSeen('sim-01');
  assert.strictEqual(calls.length, 1, 'ten publishes should produce one registry call');
});

test('throttles each device independently', async () => {
  const calls = mockPost();
  await reportSeen('sim-01');
  await reportSeen('sim-02');
  assert.strictEqual(calls.length, 2);
});

test('reports again once the throttle window has passed', async () => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] });

  const calls = mockPost();

  await reportSeen('sim-01');
  jest.setSystemTime(Date.now() + 29000);
  await reportSeen('sim-01');
  assert.strictEqual(calls.length, 1, 'still inside the throttle window');

  jest.setSystemTime(Date.now() + 2000);
  await reportSeen('sim-01');
  assert.strictEqual(calls.length, 2, 'window elapsed, reports again');
});

test('a failed report is retried on the next publish instead of waiting out the window', async () => {
  let failNext = true;
  const calls = mockPost( async () => {
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

test('a successful report does not retry until the window passes', async () => {
  const calls = mockPost();
  await reportSeen('sim-01');
  await reportSeen('sim-01');
  assert.strictEqual(calls.length, 1);
});

test('ignores a missing deviceId rather than calling with undefined in the URL', async () => {
  const calls = mockPost();
  assert.strictEqual(await reportSeen(undefined), false);
  assert.strictEqual(await reportSeen(''), false);
  assert.strictEqual(calls.length, 0);
});

test('shouldReport is true for an unseen device and false right after a report', async () => {
  mockPost();
  assert.strictEqual(shouldReport('sim-99'), true);
  await reportSeen('sim-99');
  assert.strictEqual(shouldReport('sim-99'), false);
});

afterEach(() => jest.useRealTimers());
