const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_LOGIN_MAX = '3';
const { loginLimiter } = require('../src/middleware/rateLimit');

// A stand-in for the real login route: no Mongo, no bcrypt, just the limiter in
// front of a handler whose outcome the test controls.
function startApp() {
  const app = express();
  app.set('trust proxy', 1); // mirrors index.js — key on X-Forwarded-For
  app.post('/login', loginLimiter, (req, res) => {
    if (req.headers['x-succeed']) return res.json({ ok: true });
    res.status(401).json({ error: 'invalid credentials' });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function attempt(server, ip, { succeed = false } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (succeed) headers['x-succeed'] = '1';
  return fetch(`http://127.0.0.1:${server.address().port}/login`, { method: 'POST', headers });
}

test('login rate limiting', async (t) => {
  const server = await startApp();
  t.after(() => server.close());

  await t.test('allows attempts up to the limit, then returns 429', async () => {
    const ip = '203.0.113.10';
    for (let i = 0; i < 3; i++) {
      assert.strictEqual((await attempt(server, ip)).status, 401, `attempt ${i + 1} should reach the handler`);
    }
    const blocked = await attempt(server, ip);
    assert.strictEqual(blocked.status, 429);
    assert.match((await blocked.json()).error, /Too many login attempts/);
  });

  await t.test('keys per client IP, not globally', async () => {
    // The previous IP is already blocked; a different one must be unaffected.
    assert.strictEqual((await attempt(server, '203.0.113.99')).status, 401);
  });

  await t.test('advertises the limit so a client can back off', async () => {
    const res = await attempt(server, '203.0.113.50');
    // draft-7 combines the fields into one header: "limit=3, remaining=2, reset=60"
    const header = res.headers.get('ratelimit');
    assert.ok(header, 'expected a RateLimit header');
    assert.match(header, /limit=3/);
    assert.match(header, /remaining=2/);
  });

  await t.test('successful logins do not count toward the limit', async () => {
    const ip = '203.0.113.77';
    for (let i = 0; i < 6; i++) {
      assert.strictEqual((await attempt(server, ip, { succeed: true })).status, 200);
    }
    // Still has its full budget of failures left.
    assert.strictEqual((await attempt(server, ip)).status, 401);
  });
});
