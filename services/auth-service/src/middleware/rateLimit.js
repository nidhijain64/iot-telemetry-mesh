// Brute-force protection for the credential endpoints. bcrypt makes each guess
// expensive for us as well as the attacker, so an unthrottled /login is both a
// password-guessing oracle and a cheap way to pin the CPU.
//
// The counters live in Redis when REDIS_URL is set. That matters for more than
// tidiness: with in-process counters each replica enforces its own budget, so
// the real limit is LOGIN_MAX × replicas and every pod added to the Deployment
// hands an attacker another full window of guesses.
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

function buildLimiter(max, message, prefix) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: max,
    standardHeaders: 'draft-7', // RateLimit-* headers, so a client can back off
    legacyHeaders: false,
    // Count only failed attempts: someone legitimately logging in on ten
    // devices shouldn't be locked out, but ten wrong passwords is a guesser.
    skipSuccessfulRequests: true,
    // A Redis outage must not become a login outage. Unthrottled logins for the
    // duration of the outage is the lesser failure — locking every user out of
    // their own account is an availability incident an attacker could trigger
    // deliberately by taking Redis down.
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
  'rl:register:'
);

module.exports = { loginLimiter, registerLimiter };
