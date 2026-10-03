// ============================================================
// Ring buffer of recent telemetry, per device.
//
// This buffer is only for "what's happening right now" (the dashboard's live
// view and GET /recent). Permanent history is written separately, to MongoDB,
// in broker.js (see Reading model).
//
// In-process by default, which is fine for one replica and is what `npm test`
// exercises. With REDIS_URL set it moves into Redis, because otherwise two
// replicas answer GET /recent/:deviceId with whatever each happened to receive
// — the same request returning different history depending on which pod the
// Ingress routed it to.
//
// Still not durable in either mode: Redis holds it with a TTL rather than a
// disk guarantee, and that is deliberate. Losing the live window costs a few
// seconds of chart; MongoDB is what must not lose a reading.
// ============================================================

const redis = require('./config/redis');

const RING_BUFFER_SIZE = Number(process.env.RING_BUFFER_SIZE) || 50;

// A device that stops publishing shouldn't pin its window in Redis forever.
// Long enough to outlast a reporting gap, short enough that retired devices go.
const BUFFER_TTL_S = Number(process.env.RING_BUFFER_TTL_S) || 6 * 60 * 60;

const KEY_PREFIX = 'recent:';

const buffers = new Map(); // deviceId -> array of readings, oldest first — fallback path

function pushLocal(deviceId, entry) {
  if (!buffers.has(deviceId)) buffers.set(deviceId, []);
  const buffer = buffers.get(deviceId);
  buffer.push(entry);
  if (buffer.length > RING_BUFFER_SIZE) buffer.shift(); // drop oldest — the "ring" part
}

async function push(deviceId, entry) {
  if (!redis.isEnabled()) return pushLocal(deviceId, entry);

  const key = `${KEY_PREFIX}${deviceId}`;
  try {
    // RPUSH appends, so the list stays oldest-first and matches what the
    // in-memory array returns. LTRIM to the last RING_BUFFER_SIZE entries is
    // the "ring" part — negative indices count from the tail.
    await redis.client
      .multi()
      .rpush(key, JSON.stringify(entry))
      .ltrim(key, -RING_BUFFER_SIZE, -1)
      .expire(key, BUFFER_TTL_S)
      .exec();
  } catch (err) {
    // Never let the live-view cache cost us a reading: the Mongo write and the
    // alert check in broker.js matter, this does not.
    console.warn(`[ringBuffer] redis unavailable, buffering locally: ${err.message}`);
    pushLocal(deviceId, entry);
  }
}

async function getRecent(deviceId) {
  if (!redis.isEnabled()) return buffers.get(deviceId) || [];

  try {
    const raw = await redis.client.lrange(`${KEY_PREFIX}${deviceId}`, 0, -1);
    return raw
      .map((item) => {
        try {
          return JSON.parse(item);
        } catch {
          return null; // a corrupt entry shouldn't fail the whole response
        }
      })
      .filter((entry) => entry !== null);
  } catch (err) {
    console.warn(`[ringBuffer] redis unavailable, serving local buffer: ${err.message}`);
    return buffers.get(deviceId) || [];
  }
}

module.exports = { push, getRecent };
