// Cooldown-based debounce: once an alert type fires for a device, the
// SAME alert type won't fire again for that device until the cooldown
// passes. This is what stops one noisy sensor from spamming repeated
// alerts instead of firing once per sustained issue.
//
// With REDIS_URL set the cooldown lives in Redis, and that is what makes more
// than one replica of this service safe. `SET key NX PX` is a single atomic
// command: when two replicas evaluate the same device's reading at the same
// moment, exactly one of them creates the key and exactly one alert is written.
// In-process Maps cannot give that guarantee — each replica would hold its own
// cooldown and the user would get one duplicate alert per replica.

const redis = require('../config/redis');

const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS) || 5 * 60 * 1000; // 5 min default
const KEY_PREFIX = 'debounce:';

const lastFired = new Map(); // `${deviceId}:${type}` -> timestamp — fallback path only

function shouldFireLocal(key) {
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

async function shouldFire(deviceId, type) {
  const key = `${deviceId}:${type}`;

  if (!redis.isEnabled()) return shouldFireLocal(key);

  try {
    // NX = only if the key is absent, PX = expire after the cooldown, so the
    // cooldown expires itself and there is nothing to sweep. The reply is 'OK'
    // for the call that created the key and null for every other caller that
    // raced it — so the one that set it is the one that fires.
    const won = await redis.client.set(
      `${KEY_PREFIX}${key}`,
      Date.now(),
      'PX',
      COOLDOWN_MS,
      'NX'
    );
    return won === 'OK';
  } catch (err) {
    // Redis unreachable. Fall back to the local cooldown rather than refusing to
    // fire: under a partition this can duplicate an alert across replicas, which
    // is a worse experience but a better outcome than silently dropping one.
    console.warn(`[debounce] redis unavailable, using local cooldown: ${err.message}`);
    return shouldFireLocal(key);
  }
}

module.exports = { shouldFire };
