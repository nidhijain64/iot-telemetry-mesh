const test = require('node:test');
const assert = require('node:assert');
const { serviceUrl, originList } = require('../src/config/serviceUrl');

test('adds https:// to a bare hostname (what Render fromService gives)', () => {
  assert.strictEqual(serviceUrl('auth-service-x1.onrender.com', 'fb'), 'https://auth-service-x1.onrender.com');
});

test('leaves a full URL alone, including local http', () => {
  assert.strictEqual(serviceUrl('http://localhost:3002', 'fb'), 'http://localhost:3002');
  assert.strictEqual(serviceUrl('https://a.onrender.com', 'fb'), 'https://a.onrender.com');
});

test('falls back when unset, so local dev keeps working', () => {
  assert.strictEqual(serviceUrl(undefined, 'http://localhost:3002'), 'http://localhost:3002');
  assert.strictEqual(serviceUrl('', 'http://localhost:3002'), 'http://localhost:3002');
});

test('strips trailing slashes so paths do not double up', () => {
  assert.strictEqual(serviceUrl('https://a.onrender.com///', 'fb'), 'https://a.onrender.com');
});

test('trims whitespace from a pasted value', () => {
  assert.strictEqual(serviceUrl('  a.onrender.com  ', 'fb'), 'https://a.onrender.com');
});

test('originList builds full origins an Origin header can match', () => {
  assert.deepStrictEqual(originList('a.onrender.com'), ['https://a.onrender.com']);
  assert.deepStrictEqual(
    originList('a.onrender.com, http://localhost:5173'),
    ['https://a.onrender.com', 'http://localhost:5173']
  );
});

test('originList is empty when unset — every origin allowed, as before', () => {
  assert.deepStrictEqual(originList(undefined), []);
  assert.deepStrictEqual(originList(''), []);
});
