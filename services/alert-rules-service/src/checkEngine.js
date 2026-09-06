const Alert = require('./models/Alert');
const { shouldFire } = require('./detectors/debounce');
const { checkSoundAnomaly } = require('./detectors/soundBaseline');
const { sendWebhook } = require('./webhook');

const TEMP_THRESHOLD_C = Number(process.env.TEMP_THRESHOLD_C) || 35;
const BATTERY_THRESHOLD_PCT = Number(process.env.BATTERY_THRESHOLD_PCT) || 20;

async function checkReading(reading) {
  const { deviceId } = reading;
  const candidates = [];

  if (typeof reading.temperature === 'number' && reading.temperature > TEMP_THRESHOLD_C) {
    candidates.push({
      type: 'high-temperature',
      severity: 'critical',
      value: reading.temperature,
      message: `Temperature ${reading.temperature}°C exceeds ${TEMP_THRESHOLD_C}°C threshold`,
    });
  }

  if (typeof reading.batteryLevel === 'number' && reading.batteryLevel < BATTERY_THRESHOLD_PCT) {
    candidates.push({
      type: 'low-battery',
      severity: 'critical',
      value: reading.batteryLevel,
      message: `Battery ${reading.batteryLevel}% below ${BATTERY_THRESHOLD_PCT}% threshold`,
    });
  }

  if (typeof reading.soundLevel === 'number') {
    const anomaly = checkSoundAnomaly(deviceId, reading.soundLevel);
    if (anomaly) {
      candidates.push({
        type: 'sound-anomaly',
        severity: 'warning',
        value: reading.soundLevel,
        message: `Sound level ${reading.soundLevel}dB is ${anomaly.zScore.toFixed(1)} standard deviations above this device's recent baseline (${anomaly.mean.toFixed(1)}dB avg)`,
      });
    }
  }

  const fired = [];
  for (const candidate of candidates) {
    if (!shouldFire(deviceId, candidate.type)) continue; // debounced — skip

    const saved = await Alert.create({ deviceId, ...candidate });
    fired.push(saved);

    if (candidate.severity === 'critical') {
      await sendWebhook(saved);
    }
  }

  return fired;
}

module.exports = { checkReading };
