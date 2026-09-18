// Rolling z-score anomaly detection on ambient sound level, per device.
// This is the one real algorithm in the alert pipeline, applied only to
// genuinely sensed data — running it on fake simulator numbers would be
// detecting patterns in data that was never real to begin with.

const WINDOW_SIZE = Number(process.env.SOUND_BASELINE_WINDOW) || 20;
const MIN_SAMPLES = 5; // don't judge anomalies until there's an actual baseline
const Z_SCORE_THRESHOLD = Number(process.env.SOUND_Z_SCORE_THRESHOLD) || 2.5;

// A floor on the standard deviation, in dB. A device in a steady room produces
// near-identical readings, so the real deviation approaches zero — and dividing
// by nearly zero makes an ordinary reading look enormously abnormal. This
// produced "72dB is 128.3 standard deviations above baseline" in practice:
// arithmetically correct, physically meaningless.
//
// 1.5dB is roughly the noise floor of a phone microphone, so a spread smaller
// than that is measurement precision rather than genuine quiet.
const MIN_STD_DEV = Number(process.env.SOUND_MIN_STD_DEV) || 1.5;

const history = new Map(); // deviceId -> array of recent soundLevel readings

function checkSoundAnomaly(deviceId, value) {
  if (!history.has(deviceId)) history.set(deviceId, []);
  const readings = history.get(deviceId);

  let anomaly = null;
  if (readings.length >= MIN_SAMPLES) {
    const mean = readings.reduce((a, b) => a + b, 0) / readings.length;
    const variance = readings.reduce((sum, r) => sum + (r - mean) ** 2, 0) / readings.length;
    const rawStdDev = Math.sqrt(variance);
    // Treat anything below the floor as the floor, rather than skipping the
    // check: a genuinely loud reading in a very quiet room should still fire,
    // it just should not claim an absurd number of standard deviations.
    const stdDev = Math.max(rawStdDev, MIN_STD_DEV);

    const zScore = (value - mean) / stdDev;
    if (zScore > Z_SCORE_THRESHOLD) {
      anomaly = { zScore, mean, stdDev };
    }
  }

  // Update the rolling window regardless of whether this reading was
  // flagged — the baseline has to keep moving with real conditions.
  readings.push(value);
  if (readings.length > WINDOW_SIZE) readings.shift();

  return anomaly;
}

module.exports = { checkSoundAnomaly };
