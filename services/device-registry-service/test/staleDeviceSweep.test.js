const test = require('node:test');
const assert = require('node:assert');

process.env.STALE_AFTER_MS = '120000';
const Device = require('../src/models/Device');
const { sweepStaleDevices } = require('../src/jobs/staleDeviceSweep');

// Mongo is not involved here — Device.updateMany is mocked so the test pins the
// query the sweep builds, which is where the interesting decisions live.
function mockUpdateMany(t, result = { modifiedCount: 0 }) {
  const calls = [];
  t.mock.method(Device, 'updateMany', async (filter, update) => {
    calls.push({ filter, update });
    return result;
  });
  return calls;
}

test('only touches devices that are online and have gone quiet', async (t) => {
  const calls = mockUpdateMany(t);
  await sweepStaleDevices();

  assert.strictEqual(calls.length, 1);
  const { filter } = calls[0];
  assert.strictEqual(filter.isOnline, true, 'devices already offline are left alone');
  assert.ok(filter.lastSeenAt.$lt instanceof Date);
});

test('never changes status — liveness is not an authorization decision', async (t) => {
  const calls = mockUpdateMany(t);
  await sweepStaleDevices();

  const { update } = calls[0];
  assert.deepStrictEqual(update, { isOnline: false });
  assert.ok(!('status' in update), 'a background timer must not decommission devices');
});

test('cuts off at exactly STALE_AFTER_MS before now', async (t) => {
  const calls = mockUpdateMany(t);
  const before = Date.now();
  await sweepStaleDevices();
  const after = Date.now();

  const cutoff = calls[0].filter.lastSeenAt.$lt.getTime();
  assert.ok(cutoff >= before - 120000 && cutoff <= after - 120000);
});

test('swallows a database error instead of crashing the service', async (t) => {
  t.mock.method(Device, 'updateMany', async () => {
    throw new Error('connection lost');
  });
  await assert.doesNotReject(() => sweepStaleDevices());
});
