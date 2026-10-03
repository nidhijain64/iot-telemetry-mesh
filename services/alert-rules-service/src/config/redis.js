// ============================================================
// Optional shared-state backend.
//
// Every piece of per-replica state in this service — the debounce cooldown and
// the rolling sound baseline — keeps an in-process fallback, so a single-node
// run and `npm test` need no Redis at all. Set REDIS_URL and that same state
// moves into Redis, which is the only reason this Deployment can run more than
// one replica: see k8s/23-alert-rules-service.yaml.
// ============================================================

const REDIS_URL = process.env.REDIS_URL || '';

// The client is reached through `module.exports` rather than a closed-over
// variable, and this export is declared before the connection is opened below.
// That is what lets a test substitute a stand-in client — no live server, and no
// test-only setter widening the real API. See test/sharedState.test.js.
function isEnabled() {
  return module.exports.client !== null;
}

module.exports = { client: null, isEnabled };

if (REDIS_URL) {
  const Redis = require('ioredis');
  module.exports.client = new Redis(REDIS_URL, {
    // Fail fast instead of queueing commands forever. Every caller here already
    // has a working in-memory path, so a dead Redis should surface as an error
    // they can fall back from rather than making an alert check hang until a
    // reconnect eventually succeeds.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
  // Without a listener an ioredis connection error is an unhandled 'error'
  // event, which takes the process down — the opposite of degrading gracefully.
  module.exports.client.on('error', (err) => {
    console.warn(`[redis] ${err.message}`);
  });
  console.log('[redis] shared alert state enabled');
}
