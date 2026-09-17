const test = require('node:test');
const assert = require('node:assert');

process.env.INSIGHT_MIN_ALERTS = '3';
const { clustersWorthExplaining, buildPrompt, InsightShape, RESPONSE_SCHEMA } = require('../src/agent');

const alert = (deviceId, minutesAgo, type = 'sound-anomaly', extra = {}) => ({
  _id: `${deviceId}-${minutesAgo}`,
  deviceId,
  type,
  severity: 'warning',
  value: 70,
  message: `${type} on ${deviceId}`,
  createdAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  ...extra,
});

test('groups alerts by device', () => {
  const clusters = clustersWorthExplaining([
    alert('a', 5), alert('a', 4), alert('a', 3),
    alert('b', 5), alert('b', 4), alert('b', 3),
  ]);
  assert.deepStrictEqual(clusters.map((c) => c.deviceId).sort(), ['a', 'b']);
});

test('ignores a device with too few alerts to be worth a model call', () => {
  // Two alerts explain themselves; the cost of a model call buys nothing.
  const clusters = clustersWorthExplaining([alert('a', 5), alert('a', 4)]);
  assert.deepStrictEqual(clusters, []);
});

test('a noisy device is explained while a quiet one in the same batch is not', () => {
  const clusters = clustersWorthExplaining([
    alert('noisy', 5), alert('noisy', 4), alert('noisy', 3), alert('noisy', 2),
    alert('quiet', 5),
  ]);
  assert.strictEqual(clusters.length, 1);
  assert.strictEqual(clusters[0].deviceId, 'noisy');
  assert.strictEqual(clusters[0].alerts.length, 4);
});

test('orders each cluster oldest first, so the prompt reads as a sequence', () => {
  const [cluster] = clustersWorthExplaining([alert('a', 1), alert('a', 9), alert('a', 5)]);
  const times = cluster.alerts.map((x) => new Date(x.createdAt).getTime());
  assert.deepStrictEqual(times, [...times].sort((p, q) => p - q));
});

test('the prompt carries the device, every alert, and the time span', () => {
  const alerts = [alert('phone-1', 10), alert('phone-1', 6), alert('phone-1', 2, 'motion-shake')];
  const prompt = buildPrompt('phone-1', alerts);
  assert.match(prompt, /phone-1/);
  assert.match(prompt, /3 alerts over 8 minute/);
  assert.match(prompt, /motion-shake/);
  assert.strictEqual(prompt.split('\n').filter((l) => l.includes('sound-anomaly')).length, 2);
});

test('a span under a minute still reads as 1 minute, never 0', () => {
  const now = Date.now();
  const burst = [0, 1, 2].map((i) => ({
    ...alert('a', 0), _id: `a${i}`, createdAt: new Date(now + i * 1000).toISOString(),
  }));
  assert.match(buildPrompt('a', burst), /over 1 minute/);
});

test('accepts a well-formed insight', () => {
  const r = InsightShape.safeParse({
    headline: 'Device is being carried',
    likelyCause: 'Sustained motion with sound changes.',
    recommendedAction: 'Confirm who has the device.',
    severity: 'medium',
    confidence: 'high',
  });
  assert.strictEqual(r.success, true);
});

test('rejects a severity outside the allowed set', () => {
  // strict mode constrains shape, not meaning — this is the second line of defence.
  const r = InsightShape.safeParse({
    headline: 'x', likelyCause: 'y', recommendedAction: 'z',
    severity: 'critical', confidence: 'high',
  });
  assert.strictEqual(r.success, false);
});

test('rejects an insight missing a field', () => {
  const r = InsightShape.safeParse({ headline: 'x', severity: 'low', confidence: 'low' });
  assert.strictEqual(r.success, false);
});

test('the schema sent to Groq forbids extra properties, as strict mode requires', () => {
  assert.strictEqual(RESPONSE_SCHEMA.additionalProperties, false);
  assert.deepStrictEqual(
    RESPONSE_SCHEMA.required.sort(),
    ['confidence', 'headline', 'likelyCause', 'recommendedAction', 'severity']
  );
});
