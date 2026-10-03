// ============================================================
// Optional shared-state backend.
//
// Two separate things in this service are per-process, and both of them are why
// the Deployment was pinned to one replica:
//
//   1. the Aedes broker's message emitter and session store, so a device
//      connected to replica A is invisible to a dashboard attached to replica B
//   2. the recent-telemetry ring buffer behind GET /recent/:deviceId, so two
//      replicas would answer the same request with different history
//
// Both fall back to in-process state when REDIS_URL is unset, which keeps the
// single-node run and `npm test` working with no Redis present.
// ============================================================

const REDIS_URL = process.env.REDIS_URL || '';

// Reached through `module.exports` so a test can substitute a stand-in client;
// declared before the connection is opened below.
function isEnabled() {
  return module.exports.client !== null;
}

// The Aedes Redis packages take ioredis *options* rather than a URL, so the URL
// has to be broken apart for them. mqemitter-redis accepts `connectionString`
// directly and gets the URL as-is.
function connectionOptions() {
  if (!REDIS_URL) return null;
  const url = new URL(REDIS_URL);
  const db = url.pathname && url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.username ? { username: url.username } : {}),
    ...(url.password ? { password: url.password } : {}),
    ...(Number.isFinite(db) ? { db } : {}),
  };
}

module.exports = { client: null, isEnabled, connectionOptions, REDIS_URL };

if (REDIS_URL) {
  const Redis = require('ioredis');
  module.exports.client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
  module.exports.client.on('error', (err) => {
    console.warn(`[redis] ${err.message}`);
  });
  console.log('[redis] shared broker and ring buffer enabled');
}
