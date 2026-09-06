// Rolling z-score anomaly detection on ambient sound level, per device.
// This is the one real algorithm in the alert pipeline, applied only to
// genuinely sensed data — running it on fake simulator numbers would be
// detecting patterns in data that was never real to begin with.

const WINDOW_SIZE = Number(process.env.SOUND_BASELINE_WINDOW) || 20;
const MIN_SAMPLES = 5; // don't judge anomalies until there's an actual baseline
const Z_SCORE_THRESHOLD = Number(process.env.SOUND_Z_SCORE_THRESHOLD) || 2.5;

const history = new Map(); // deviceId -> array of recent soundLevel readings

function checkSoundAnomaly(deviceId, value) {
  if (!history.has(deviceId)) history.set(deviceId, []);
  const readings = history.get(deviceId);

  let anomaly = null;
  if (readings.length >= MIN_SAMPLES) {
    const mean = readings.reduce((a, b) => a + b, 0) / readings.length;
    const variance = readings.reduce((sum, r) => sum + (r - mean) ** 2, 0) / readings.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev > 0) {
      const zScore = (value - mean) / stdDev;
      if (zScore > Z_SCORE_THRESHOLD) {
        anomaly = { zScore, mean, stdDev };
      }
    }
  }

  // Update the rolling window regardless of whether this reading was
  // flagged — the baseline has to keep moving with real conditions.
  readings.push(value);
  if (readings.length > WINDOW_SIZE) readings.shift();

  return anomaly;
}

module.exports = { checkSoundAnomaly };
