// ============================================================
// Optional shared store for the login rate limiter.
//
// Without it the limiter counts in process memory, so each replica enforces its
// own budget and the effective limit is RATE_LIMIT_LOGIN_MAX × replicas — an
// attacker gains an extra window of guesses for every pod that gets scheduled.
// With REDIS_URL set the counters are shared and the advertised limit is the
// real one, whatever the replica count.
// ============================================================

const REDIS_URL = process.env.REDIS_URL || '';

// Reached through `module.exports` so a test can substitute a stand-in client;
// declared before the connection is opened below.
function isEnabled() {
  return module.exports.client !== null;
}

module.exports = { client: null, isEnabled };

if (REDIS_URL) {
  const Redis = require('ioredis');
  module.exports.client = new Redis(REDIS_URL, {
    // The limiter is in the request path, so a Redis stall must not become a
    // login stall. Bounded retries, then rate-limit-redis surfaces the failure
    // and passOnStoreError lets the request through rather than hang.
    maxRetriesPerRequest: 2,
    // Offline queue left ENABLED (the default): ioredis connects asynchronously,
    // so logins in the first milliseconds after boot would otherwise fail the
    // store and run unthrottled. Queued commands run once the socket is ready.
  });
  module.exports.client.on('error', (err) => {
    console.warn(`[redis] ${err.message}`);
  });
  console.log('[redis] shared rate-limit counters enabled');
}
