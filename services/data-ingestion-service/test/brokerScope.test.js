// Guards the tenant boundary on the live MQTT stream. REST scoping is enforced
// in device-registry; this is the separate check that a viewer's socket only
// ever receives telemetry for devices that viewer is allowed to see.
const assert = require('node:assert');

const { createBroker } = require('../src/broker');

function viewer(deviceIds) {
  return { isViewer: true, visibleDeviceIds: new Set(deviceIds) };
}
const packetFor = (deviceId) => ({ topic: `telemetry/${deviceId}`, payload: Buffer.from('{}') });

describe('authorizeForward enforces per-viewer device scope', () => {
  let aedes;
  let forward;
  beforeAll(async () => { aedes = await createBroker(); forward = aedes.authorizeForward; });
  afterAll(() => new Promise(resolve => aedes.close(resolve)));

  test('delivers telemetry for a device in scope', () => {
    assert.ok(forward(viewer(['sim-01']), packetFor('sim-01')));
  });

  test("drops telemetry for another user's device", () => {
    assert.strictEqual(forward(viewer(['sim-01']), packetFor('sim-02')), null);
  });

  test('drops everything when the scope failed to load', () => {
    assert.strictEqual(forward(viewer([]), packetFor('sim-01')), null);
  });

  test('drops non-telemetry topics for viewers', () => {
    const client = viewer(['sim-01']);
    assert.strictEqual(forward(client, { topic: '$SYS/uptime' }), null);
  });

  test('leaves device (non-viewer) clients untouched', () => {
    const packet = packetFor('sim-01');
    assert.strictEqual(forward({ isViewer: false, deviceId: 'sim-01' }, packet), packet);
  });
});
