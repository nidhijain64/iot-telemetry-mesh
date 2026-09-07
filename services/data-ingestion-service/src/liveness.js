// ============================================================
// Reports device liveness to device-registry, derived from the data path:
// a device that is publishing is alive, so nothing has to send a separate
// heartbeat and no client can claim to be online while sending nothing.
//
// Throttled per device, because devices publish every few seconds and the
// registry only needs to know a device was seen recently — not the exact
// moment of every message.
// ============================================================

const axios = require('axios');

const { serviceUrl } = require('./config/serviceUrl');

const DEVICE_REGISTRY_URL = serviceUrl(process.env.DEVICE_REGISTRY_URL, 'http://localhost:3002');
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

// Must stay comfortably below device-registry's STALE_AFTER_MS (default 120s),
// or a device would be swept offline in the gap between two reports and flicker
// on the dashboard while it is publishing perfectly happily.
const THROTTLE_MS = Number(process.env.LIVENESS_THROTTLE_MS) || 30 * 1000;

const lastReported = new Map(); // deviceId -> timestamp of last successful report

function shouldReport(deviceId, now = Date.now()) {
  const last = lastReported.get(deviceId);
  // `last !== undefined`, not truthiness — a recorded time of 0 is still a time.
  return last === undefined || now - last >= THROTTLE_MS;
}

async function reportSeen(deviceId) {
  if (!deviceId || !shouldReport(deviceId)) return false;

  // Recorded before the request, not after, so a burst of publishes can't fire
  // a burst of concurrent requests while the first is still in flight.
  lastReported.set(deviceId, Date.now());

  try {
    await axios.post(
      `${DEVICE_REGISTRY_URL}/api/devices/${deviceId}/seen`,
      {},
      { headers: { 'x-service-key': INTERNAL_SERVICE_KEY }, timeout: 3000 }
    );
    return true;
  } catch (err) {
    // Drop the throttle entry so the very next publish retries, rather than
    // leaving the device looking offline until the throttle window expires.
    lastReported.delete(deviceId);
    console.warn(`[liveness] could not report ${deviceId} as seen: ${err.message}`);
    return false;
  }
}

// Test seam — the throttle is module-level state shared across the process.
function _resetThrottle() {
  lastReported.clear();
}

module.exports = { reportSeen, shouldReport, _resetThrottle, THROTTLE_MS };
