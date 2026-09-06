// Cooldown-based debounce: once an alert type fires for a device, the
// SAME alert type won't fire again for that device until the cooldown
// passes. This is what stops one noisy sensor from spamming repeated
// alerts instead of firing once per sustained issue.

const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS) || 5 * 60 * 1000; // 5 min default
const lastFired = new Map(); // `${deviceId}:${type}` -> timestamp

function shouldFire(deviceId, type) {
  const key = `${deviceId}:${type}`;
  const now = Date.now();
  const last = lastFired.get(key);
  // `last !== undefined`, not a truthiness check — a timestamp of 0 is a real
  // recorded time, and treating it as "never fired" would skip the cooldown.
  if (last !== undefined && now - last < COOLDOWN_MS) {
    return false; // still in cooldown
  }
  lastFired.set(key, now);
  return true;
}

module.exports = { shouldFire };
