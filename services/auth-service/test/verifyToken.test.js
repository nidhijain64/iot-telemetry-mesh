const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-not-used-anywhere-real';
const { verifyToken, requireRole } = require('../src/middleware/verifyToken');

const sign = (payload, opts = {}) =>
  jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h', ...opts });

// Minimal Express double: records the status/body a middleware responded with,
// and whether it handed control onward.
function harness(headers = {}) {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const req = { headers };
  let nextCalled = false;
  return { req, res, next: () => { nextCalled = true; }, calledNext: () => nextCalled };
}

test('rejects a request with no Authorization header', () => {
  const h = harness();
  verifyToken(h.req, h.res, h.next);
  assert.strictEqual(h.res.statusCode, 401);
  assert.strictEqual(h.calledNext(), false);
});

test('rejects an Authorization header that is not a Bearer token', () => {
  const h = harness({ authorization: 'Basic dXNlcjpwYXNz' });
  verifyToken(h.req, h.res, h.next);
  assert.strictEqual(h.res.statusCode, 401);
  assert.strictEqual(h.calledNext(), false);
});

test('accepts a valid token and attaches the claims to req.user', () => {
  const h = harness({ authorization: `Bearer ${sign({ sub: 'u1', username: 'nidhi', role: 'operator' })}` });
  verifyToken(h.req, h.res, h.next);
  assert.strictEqual(h.calledNext(), true);
  assert.strictEqual(h.req.user.sub, 'u1');
  assert.strictEqual(h.req.user.role, 'operator');
});

test('rejects a token signed with a different secret', () => {
  const forged = jwt.sign({ sub: 'u1', role: 'admin' }, 'some-other-secret', { algorithm: 'HS256' });
  const h = harness({ authorization: `Bearer ${forged}` });
  verifyToken(h.req, h.res, h.next);
  assert.strictEqual(h.res.statusCode, 401);
  assert.strictEqual(h.calledNext(), false);
});

test('reports an expired token distinctly so the client can re-login', () => {
  const h = harness({ authorization: `Bearer ${sign({ sub: 'u1' }, { expiresIn: '-1s' })}` });
  verifyToken(h.req, h.res, h.next);
  assert.strictEqual(h.res.statusCode, 401);
  assert.strictEqual(h.res.body.error, 'Token expired');
});

// A token whose header says alg:none is the classic JWT bypass — jsonwebtoken
// is pinned to HS256 at the call site, so it must not be honoured.
test('rejects an unsigned alg:none token', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: 'u1', role: 'admin' })).toString('base64url');
  const h = harness({ authorization: `Bearer ${header}.${body}.` });
  verifyToken(h.req, h.res, h.next);
  assert.strictEqual(h.res.statusCode, 401);
  assert.strictEqual(h.calledNext(), false);
});

test('requireRole lets a matching role through', () => {
  const h = harness();
  h.req.user = { sub: 'u1', role: 'admin' };
  requireRole('admin')(h.req, h.res, h.next);
  assert.strictEqual(h.calledNext(), true);
});

test('requireRole blocks a non-matching role with 403, not 401', () => {
  const h = harness();
  h.req.user = { sub: 'u1', role: 'operator' };
  requireRole('admin')(h.req, h.res, h.next);
  assert.strictEqual(h.res.statusCode, 403);
  assert.strictEqual(h.calledNext(), false);
});

test('requireRole blocks an unauthenticated request', () => {
  const h = harness();
  requireRole('admin')(h.req, h.res, h.next);
  assert.strictEqual(h.res.statusCode, 403);
  assert.strictEqual(h.calledNext(), false);
});
