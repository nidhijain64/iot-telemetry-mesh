const test = require('node:test');
const assert = require('node:assert');

process.env.SOUND_BASELINE_WINDOW = '20';
process.env.SOUND_Z_SCORE_THRESHOLD = '2.5';
const { checkSoundAnomaly } = require('../src/detectors/soundBaseline');

// Feeds a device a jittered-but-stable baseline so stdDev is non-zero.
function warmUp(deviceId, count = 10) {
  for (let i = 0; i < count; i++) checkSoundAnomaly(deviceId, 50 + (i % 3));
}

test('stays silent until there is enough of a baseline to judge against', () => {
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(checkSoundAnomaly('sound-1', 50 + i), null);
  }
});

test('does not flag a reading in line with the baseline', () => {
  warmUp('sound-2');
  assert.strictEqual(checkSoundAnomaly('sound-2', 51), null);
});

test('flags a spike well above the baseline', () => {
  warmUp('sound-3');
  const anomaly = checkSoundAnomaly('sound-3', 95);
  assert.ok(anomaly, 'expected an anomaly');
  assert.ok(anomaly.zScore > 2.5);
  assert.ok(anomaly.mean > 49 && anomaly.mean < 53);
});

test('ignores a drop far below the baseline — quiet is not an alarm', () => {
  warmUp('sound-4');
  assert.strictEqual(checkSoundAnomaly('sound-4', 5), null);
});

test('keeps a separate baseline per device', () => {
  warmUp('sound-5');
  // A loud device whose own baseline is loud should not be flagged by it.
  for (let i = 0; i < 10; i++) checkSoundAnomaly('sound-6', 90 + (i % 3));
  assert.strictEqual(checkSoundAnomaly('sound-6', 91), null);
});

test('baseline follows a sustained shift instead of alerting forever', () => {
  warmUp('sound-7');
  assert.ok(checkSoundAnomaly('sound-7', 95), 'first spike flags');
  // Sustained loudness gets absorbed into the rolling window.
  for (let i = 0; i < 25; i++) checkSoundAnomaly('sound-7', 95 + (i % 3));
  assert.strictEqual(checkSoundAnomaly('sound-7', 96), null, 'new normal is no longer an anomaly');
});
