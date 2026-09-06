const Device = require('../models/Device');

const STALE_AFTER_MS = Number(process.env.STALE_AFTER_MS) || 2 * 60 * 1000;
const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS) || 30 * 1000;

async function sweepStaleDevices() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  try {
    // Flips isOnline only — never status. Liveness isn't an authorization
    // decision, so a background timer must never make the kind of change
    // that PATCH /status gates to admins.
    const result = await Device.updateMany(
      { isOnline: true, lastSeenAt: { $lt: cutoff } },
      { isOnline: false }
    );
    if (result.modifiedCount > 0) {
      console.log(`[stale-sweep] marked ${result.modifiedCount} device(s) isOnline=false`);
    }
  } catch (err) {
    console.error('[stale-sweep] failed:', err.message);
  }
}

function startStaleDeviceSweep() {
  setInterval(sweepStaleDevices, SWEEP_INTERVAL_MS);
  console.log(`[stale-sweep] running every ${SWEEP_INTERVAL_MS / 1000}s, marks isOnline=false after ${STALE_AFTER_MS / 1000}s of silence`);
}

module.exports = { startStaleDeviceSweep, sweepStaleDevices };
