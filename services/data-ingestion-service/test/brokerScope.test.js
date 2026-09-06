// Guards the tenant boundary on the live MQTT stream. REST scoping is enforced
// in device-registry; this is the separate check that a viewer's socket only
// ever receives telemetry for devices that viewer is allowed to see.
const test = require('node:test');
const assert = require('node:assert');

const { createBroker } = require('../src/broker');

function viewer(deviceIds) {
  return { isViewer: true, visibleDeviceIds: new Set(deviceIds) };
}
const packetFor = (deviceId) => ({ topic: `telemetry/${deviceId}`, payload: Buffer.from('{}') });

test('authorizeForward enforces per-viewer device scope', async (t) => {
  const aedes = await createBroker();
  t.after(() => aedes.close());

  const forward = aedes.authorizeForward;

  await t.test('delivers telemetry for a device in scope', () => {
    assert.ok(forward(viewer(['sim-01']), packetFor('sim-01')));
  });

  await t.test("drops telemetry for another user's device", () => {
    assert.strictEqual(forward(viewer(['sim-01']), packetFor('sim-02')), null);
  });

  await t.test('drops everything when the scope failed to load', () => {
    assert.strictEqual(forward(viewer([]), packetFor('sim-01')), null);
  });

  await t.test('drops non-telemetry topics for viewers', () => {
    const client = viewer(['sim-01']);
    assert.strictEqual(forward(client, { topic: '$SYS/uptime' }), null);
  });

  await t.test('leaves device (non-viewer) clients untouched', () => {
    const packet = packetFor('sim-01');
    assert.strictEqual(forward({ isViewer: false, deviceId: 'sim-01' }, packet), packet);
  });
});
