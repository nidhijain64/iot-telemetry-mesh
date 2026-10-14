// Optional Redis backend for broker state and recent readings.
// Without REDIS_URL, state is local to one process.

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
    // Bounded retries, then the command rejects and the caller falls back.
    maxRetriesPerRequest: 2,
    // Offline queue left ENABLED (the default): ioredis connects asynchronously,
    // so readings arriving in the first milliseconds after boot would otherwise
    // bypass the shared buffer and land only in this replica's memory.
  });
  module.exports.client.on('error', (err) => {
    console.warn(`[redis] ${err.message}`);
  });
  console.log('[redis] shared broker and ring buffer enabled');
}
