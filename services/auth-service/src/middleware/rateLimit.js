// Brute-force protection for the credential endpoints. bcrypt makes each guess
// expensive for us as well as the attacker, so an unthrottled /login is both a
// password-guessing oracle and a cheap way to pin the CPU.
const rateLimit = require('express-rate-limit');

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const LOGIN_MAX = Number(process.env.RATE_LIMIT_LOGIN_MAX) || 10;
const REGISTER_MAX = Number(process.env.RATE_LIMIT_REGISTER_MAX) || 5;

function buildLimiter(max, message) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: max,
    standardHeaders: 'draft-7', // RateLimit-* headers, so a client can back off
    legacyHeaders: false,
    // Count only failed attempts: someone legitimately logging in on ten
    // devices shouldn't be locked out, but ten wrong passwords is a guesser.
    skipSuccessfulRequests: true,
    message: { error: message },
  });
}

const loginLimiter = buildLimiter(
  LOGIN_MAX,
  'Too many login attempts. Try again later.'
);

const registerLimiter = buildLimiter(
  REGISTER_MAX,
  'Too many accounts created from this address. Try again later.'
);

module.exports = { loginLimiter, registerLimiter };
