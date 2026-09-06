const test = require('node:test');
const assert = require('node:assert');

process.env.RING_BUFFER_SIZE = '3';
const ringBuffer = require('../src/ringBuffer');

test('returns an empty array for a device that has never published', () => {
  assert.deepStrictEqual(ringBuffer.getRecent('never-seen'), []);
});

test('keeps readings in arrival order', () => {
  ringBuffer.push('dev-a', { n: 1 });
  ringBuffer.push('dev-a', { n: 2 });
  assert.deepStrictEqual(ringBuffer.getRecent('dev-a'), [{ n: 1 }, { n: 2 }]);
});

test('drops the oldest reading once the buffer is full', () => {
  for (const n of [1, 2, 3, 4, 5]) ringBuffer.push('dev-b', { n });
  assert.deepStrictEqual(ringBuffer.getRecent('dev-b'), [{ n: 3 }, { n: 4 }, { n: 5 }]);
});

test('keeps each device in its own buffer', () => {
  ringBuffer.push('dev-c', { n: 'c' });
  ringBuffer.push('dev-d', { n: 'd' });
  assert.deepStrictEqual(ringBuffer.getRecent('dev-c'), [{ n: 'c' }]);
  assert.deepStrictEqual(ringBuffer.getRecent('dev-d'), [{ n: 'd' }]);
});
