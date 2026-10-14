// Rate-limit credential endpoints. Redis shares counters across replicas.
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../config/redis');

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const LOGIN_MAX = Number(process.env.RATE_LIMIT_LOGIN_MAX) || 10;
const REGISTER_MAX = Number(process.env.RATE_LIMIT_REGISTER_MAX) || 5;

// Each limiter needs its own key namespace, or a failed login and a failed
// registration from the same address would share one counter and the smaller
// of the two limits would silently govern both.
function buildStore(prefix) {
  if (!redis.isEnabled()) return undefined; // express-rate-limit's in-memory default
  return new RedisStore({
    sendCommand: (...args) => redis.client.call(...args),
    prefix,
  });
}

function buildLimiter(max, message, prefix, skipSuccessfulRequests = true) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: max,
    standardHeaders: 'draft-7', // RateLimit-* headers, so a client can back off
    legacyHeaders: false,
    // Count only failed attempts: someone legitimately logging in on ten
    // devices shouldn't be locked out, but ten wrong passwords is a guesser.
    skipSuccessfulRequests,
    // Fail open on Redis errors to keep login available during an outage.
    passOnStoreError: true,
    store: buildStore(prefix),
    message: { error: message },
  });
}

const loginLimiter = buildLimiter(
  LOGIN_MAX,
  'Too many login attempts. Try again later.',
  'rl:login:'
);

const registerLimiter = buildLimiter(
  REGISTER_MAX,
  'Too many accounts created from this address. Try again later.',
  'rl:register:',
  false
);

module.exports = { loginLimiter, registerLimiter };
