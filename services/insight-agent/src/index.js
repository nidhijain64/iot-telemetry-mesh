require('dotenv').config({ quiet: true });
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const Groq = require('groq-sdk');
const { HttpsProxyAgent } = require('https-proxy-agent');
const connectDB = require('./config/db');
const { serviceUrl, originList } = require('./config/serviceUrl');
const { verifyToken } = require('./middleware/verifyToken');
const Insight = require('./models/Insight');
const agent = require('./agent');

const app = express();
const PORT = process.env.PORT || 3006;
const ALERT_SERVICE_URL = serviceUrl(process.env.ALERT_SERVICE_URL, 'http://localhost:3004');
const DEVICE_REGISTRY_URL = serviceUrl(process.env.DEVICE_REGISTRY_URL, 'http://localhost:3002');
const POLL_INTERVAL_MS = Number(process.env.INSIGHT_POLL_INTERVAL_MS) || 60 * 1000;

if (!process.env.JWT_SECRET) {
  console.error('[boot] JWT_SECRET is not set — refusing to start');
  process.exit(1);
}
if (!process.env.INTERNAL_SERVICE_KEY) {
  console.error('[boot] INTERNAL_SERVICE_KEY is not set — refusing to start');
  process.exit(1);
}
// Unlike the other services, this one is useless without its model credentials,
// so it says so at boot rather than failing silently on the first poll.
if (!process.env.GROQ_API_KEY) {
  console.error('[boot] GROQ_API_KEY is not set — refusing to start');
  process.exit(1);
}

const allowedOrigins = originList(process.env.CORS_ORIGIN);
if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.warn('[boot] CORS_ORIGIN is not set — every origin is allowed. Set it in production.');
}

app.use(helmet());
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : true }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'insight-agent' }));

// Human-facing. Insights have no owner of their own, so scoping reuses
// device-registry's already-scoped device list — the same approach the alert
// feed takes, rather than reimplementing ownership here and risking the two
// drifting apart.
app.get('/api/insights', verifyToken, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role !== 'admin') {
      const { data: devices } = await axios.get(`${DEVICE_REGISTRY_URL}/api/devices`, {
        headers: { Authorization: req.headers.authorization },
        timeout: 5000,
      });
      filter = { deviceId: { $in: devices.map((d) => d.deviceId) } };
    }
    const insights = await Insight.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    return res.json(insights);
  } catch (err) {
    console.error('[insights/list]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'route not found' }));
app.use((err, req, res, next) => {
  console.error('[unhandled]', err.message);
  res.status(err.status || 500).json({ error: 'internal server error' });
});

// groq-sdk uses node-fetch, which — like Node's built-in fetch — ignores
// HTTP_PROXY and HTTPS_PROXY, unlike curl. On a network that requires a proxy
// the SDK times out with a bare "Connection error" and no hint that a proxy was
// the cause. Passing an explicit agent makes it behave like every other HTTP
// client on the machine; with no proxy set, the client is constructed as normal.
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) console.log(`[boot] routing model calls through proxy ${proxyUrl}`);

const groq = new Groq(proxyUrl ? { httpAgent: new HttpsProxyAgent(proxyUrl) } : {});

async function pollOnce() {
  let alerts;
  try {
    const since = new Date(Date.now() - agent.WINDOW_MS).toISOString();
    const { data } = await axios.get(`${ALERT_SERVICE_URL}/api/alerts/internal/recent`, {
      headers: { 'x-service-key': process.env.INTERNAL_SERVICE_KEY },
      params: { since },
      timeout: 5000,
    });
    alerts = data;
  } catch (err) {
    console.warn(`[agent] could not read alerts: ${err.message}`);
    return;
  }

  const clusters = agent.clustersWorthExplaining(alerts);
  for (const cluster of clusters) {
    // Checked per device rather than globally: a quiet device that suddenly
    // misbehaves should not be held back because a different one was noisy.
    if (await agent.recentlyExplained(cluster.deviceId)) continue;
    try {
      const insight = await agent.explainCluster(groq, cluster);
      if (insight) {
        console.log(`[agent] ${cluster.deviceId}: ${insight.headline} (${insight.severity})`);
      }
    } catch (err) {
      // One device failing must not stop the others being looked at.
      console.error(`[agent] ${cluster.deviceId} failed: ${err.message}`);
    }
  }
}

async function start() {
  await connectDB();
  app.listen(PORT, () => console.log(`[insight-agent] listening on :${PORT}`));

  // Polling rather than a push from alert-rules: the agent is allowed to be
  // slow and to fail without affecting anything upstream. Nothing in the
  // ingestion path waits on it.
  setInterval(() => {
    pollOnce().catch((err) => console.error('[agent] poll failed:', err.message));
  }, POLL_INTERVAL_MS);
  console.log(`[agent] polling every ${POLL_INTERVAL_MS / 1000}s, window ${agent.WINDOW_MS / 60000}min, min ${agent.MIN_ALERTS} alerts`);
}

start().catch((err) => {
  console.error('[boot] failed to start:', err.message);
  process.exit(1);
});
