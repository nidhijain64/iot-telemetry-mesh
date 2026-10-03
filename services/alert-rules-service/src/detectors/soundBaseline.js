// Rolling z-score anomaly detection on ambient sound level, per device.
// This is the one real algorithm in the alert pipeline, applied only to
// genuinely sensed data — running it on fake simulator numbers would be
// detecting patterns in data that was never real to begin with.
//
// The window lives in Redis when REDIS_URL is set, so every replica judges a
// reading against the same baseline instead of each one building its own from
// whatever subset of traffic it happened to receive.

const redis = require('../config/redis');

const WINDOW_SIZE = Number(process.env.SOUND_BASELINE_WINDOW) || 20;
const MIN_SAMPLES = 5; // don't judge anomalies until there's an actual baseline
const Z_SCORE_THRESHOLD = Number(process.env.SOUND_Z_SCORE_THRESHOLD) || 2.5;

// A device that stops reporting shouldn't hold its window in Redis forever.
// Comfortably longer than any real reporting gap, short enough that decommissioned
// devices age out on their own.
const WINDOW_TTL_S = Number(process.env.SOUND_BASELINE_TTL_S) || 24 * 60 * 60;

// A floor on the standard deviation, in dB. A device in a steady room produces
// near-identical readings, so the real deviation approaches zero — and dividing
// by nearly zero makes an ordinary reading look enormously abnormal. This
// produced "72dB is 128.3 standard deviations above baseline" in practice:
// arithmetically correct, physically meaningless.
//
// 1.5dB is roughly the noise floor of a phone microphone, so a spread smaller
// than that is measurement precision rather than genuine quiet.
const MIN_STD_DEV = Number(process.env.SOUND_MIN_STD_DEV) || 1.5;

const KEY_PREFIX = 'sound:';

const history = new Map(); // deviceId -> array of recent soundLevel readings — fallback path

// The statistics, kept separate from where the window is stored so the identical
// maths runs over an in-process array and over a Redis list.
function evaluate(readings, value) {
  if (readings.length < MIN_SAMPLES) return null;

  const mean = readings.reduce((a, b) => a + b, 0) / readings.length;
  const variance = readings.reduce((sum, r) => sum + (r - mean) ** 2, 0) / readings.length;
  const rawStdDev = Math.sqrt(variance);
  // Treat anything below the floor as the floor, rather than skipping the
  // check: a genuinely loud reading in a very quiet room should still fire,
  // it just should not claim an absurd number of standard deviations.
  const stdDev = Math.max(rawStdDev, MIN_STD_DEV);

  const zScore = (value - mean) / stdDev;
  if (zScore > Z_SCORE_THRESHOLD) {
    return { zScore, mean, stdDev };
  }
  return null;
}

function localWindow(deviceId) {
  if (!history.has(deviceId)) history.set(deviceId, []);
  return history.get(deviceId);
}

function appendLocal(deviceId, value) {
  const readings = localWindow(deviceId);
  readings.push(value);
  if (readings.length > WINDOW_SIZE) readings.shift();
}

async function checkSoundAnomaly(deviceId, value) {
  if (!redis.isEnabled()) {
    const anomaly = evaluate(localWindow(deviceId), value);
    // Update the rolling window regardless of whether this reading was
    // flagged — the baseline has to keep moving with real conditions.
    appendLocal(deviceId, value);
    return anomaly;
  }

  const key = `${KEY_PREFIX}${deviceId}`;

  try {
    const raw = await redis.client.lrange(key, 0, WINDOW_SIZE - 1);
    // Redis stores everything as strings; a value that somehow isn't a number
    // is dropped rather than poisoning the mean with NaN.
    const readings = raw.map(Number).filter((n) => Number.isFinite(n));

    const anomaly = evaluate(readings, value);

    // One round trip for all three: push the reading, trim back to the window,
    // and refresh the expiry. LPUSH puts the newest at index 0, so LTRIM to
    // [0, WINDOW_SIZE - 1] is what keeps the window rolling.
    await redis.client
      .multi()
      .lpush(key, value)
      .ltrim(key, 0, WINDOW_SIZE - 1)
      .expire(key, WINDOW_TTL_S)
      .exec();

    // Two replicas can read the same window concurrently and both conclude the
    // same reading is anomalous. That is deliberate rather than guarded here:
    // the debounce in debounce.js is atomic, so the duplicate candidates
    // collapse to a single written alert. Making the baseline read-modify-write
    // atomic as well would cost a Lua script for no additional guarantee.
    return anomaly;
  } catch (err) {
    // Redis unreachable: fall back to this replica's own window. The baseline
    // starts cold, so detection goes quiet for MIN_SAMPLES readings rather than
    // producing judgements against a window that isn't there.
    console.warn(`[soundBaseline] redis unavailable, using local window: ${err.message}`);
    const anomaly = evaluate(localWindow(deviceId), value);
    appendLocal(deviceId, value);
    return anomaly;
  }
}

module.exports = { checkSoundAnomaly };
