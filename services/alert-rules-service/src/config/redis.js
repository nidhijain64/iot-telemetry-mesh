// Optional Redis backend for shared debounce and sound baselines.

const REDIS_URL = process.env.REDIS_URL || '';

// Export the client before connecting so tests can replace it.
function isEnabled() {
  return module.exports.client !== null;
}

module.exports = { client: null, isEnabled };

if (REDIS_URL) {
  const Redis = require('ioredis');
  module.exports.client = new Redis(REDIS_URL, {
    // Bounded retries, then the command rejects and the caller falls back to its
    // in-memory path. A dead Redis must not make an alert check hang waiting for
    // a reconnect that may never come.
    maxRetriesPerRequest: 2,
    // Queue commands while Redis connects; maxRetriesPerRequest bounds failures.
  });
  // Without a listener an ioredis connection error is an unhandled 'error'
  // event, which takes the process down — the opposite of degrading gracefully.
  module.exports.client.on('error', (err) => {
    console.warn(`[redis] ${err.message}`);
  });
  console.log('[redis] shared alert state enabled');
}
