// ============================================================
// In-memory ring buffer of recent telemetry, per device.
// NOT persisted — restarting this service clears it. That's
// deliberate: this buffer is only for "what's happening right now"
// (the dashboard's live view and GET /recent). Permanent history
// is written separately, to MongoDB, in broker.js (see Reading model).
// ============================================================

const RING_BUFFER_SIZE = Number(process.env.RING_BUFFER_SIZE) || 50;
const buffers = new Map(); // deviceId -> array of readings, oldest first

function push(deviceId, entry) {
  if (!buffers.has(deviceId)) buffers.set(deviceId, []);
  const buffer = buffers.get(deviceId);
  buffer.push(entry);
  if (buffer.length > RING_BUFFER_SIZE) buffer.shift(); // drop oldest — the "ring" part
}

function getRecent(deviceId) {
  return buffers.get(deviceId) || [];
}

module.exports = { push, getRecent };
