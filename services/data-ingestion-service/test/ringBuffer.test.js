const test = require('node:test');
const assert = require('node:assert');

process.env.RING_BUFFER_SIZE = '3';
const ringBuffer = require('../src/ringBuffer');

test('returns an empty array for a device that has never published', async () => {
  assert.deepStrictEqual(await ringBuffer.getRecent('never-seen'), []);
});

test('keeps readings in arrival order', async () => {
  await ringBuffer.push('dev-a', { n: 1 });
  await ringBuffer.push('dev-a', { n: 2 });
  assert.deepStrictEqual(await ringBuffer.getRecent('dev-a'), [{ n: 1 }, { n: 2 }]);
});

test('drops the oldest reading once the buffer is full', async () => {
  for (const n of [1, 2, 3, 4, 5]) await ringBuffer.push('dev-b', { n });
  assert.deepStrictEqual(await ringBuffer.getRecent('dev-b'), [{ n: 3 }, { n: 4 }, { n: 5 }]);
});

test('keeps each device in its own buffer', async () => {
  await ringBuffer.push('dev-c', { n: 'c' });
  await ringBuffer.push('dev-d', { n: 'd' });
  assert.deepStrictEqual(await ringBuffer.getRecent('dev-c'), [{ n: 'c' }]);
  assert.deepStrictEqual(await ringBuffer.getRecent('dev-d'), [{ n: 'd' }]);
});
