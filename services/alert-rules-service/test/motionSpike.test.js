const test = require('node:test');
const assert = require('node:assert');

process.env.MOTION_SHAKE_THRESHOLD = '25';
const { checkMotionSpike } = require('../src/detectors/motionSpike');

test('a phone lying still does not register a shake', () => {
  // Face-up at rest: gravity shows up as ~9.81 on one axis.
  assert.strictEqual(checkMotionSpike({ x: 0, y: 0, z: 9.81 }), null);
});

test('gentle handling stays below the threshold', () => {
  assert.strictEqual(checkMotionSpike({ x: 1.2, y: 2.0, z: 9.5 }), null);
});

test('a firm shake fires', () => {
  const r = checkMotionSpike({ x: 18, y: 14, z: 12 });
  assert.ok(r, 'expected a spike');
  assert.ok(r.magnitude > 25);
});

test('is orientation-independent — same shake, different axis', () => {
  const flat = checkMotionSpike({ x: 0, y: 0, z: 30 });
  const upright = checkMotionSpike({ x: 30, y: 0, z: 0 });
  assert.ok(flat && upright);
  assert.strictEqual(flat.magnitude, upright.magnitude);
});

test('reports g-force relative to rest, so still ~= 0g', () => {
  const r = checkMotionSpike({ x: 0, y: 0, z: 30 });
  assert.ok(r.gForce > 1.5 && r.gForce < 2.5, `got ${r.gForce}`);
});

test('ignores readings with no motion data rather than throwing', () => {
  assert.strictEqual(checkMotionSpike(undefined), null);
  assert.strictEqual(checkMotionSpike(null), null);
  assert.strictEqual(checkMotionSpike({}), null);
  assert.strictEqual(checkMotionSpike({ x: 1, y: 2 }), null);
  assert.strictEqual(checkMotionSpike({ x: null, y: null, z: null }), null);
});

test('a simulator reading with no motion field is unaffected', () => {
  assert.strictEqual(checkMotionSpike({ temperature: 22 }.motion), null);
});
