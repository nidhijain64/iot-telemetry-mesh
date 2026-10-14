require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { serviceUrl, originList } = require('./config/serviceUrl');

const app = express();
const PORT = process.env.PORT || 3005;

const AUTH_URL = serviceUrl(process.env.AUTH_URL, 'http://localhost:3001');
const DEVICE_REGISTRY_URL = serviceUrl(process.env.DEVICE_REGISTRY_URL, 'http://localhost:3002');
const INGESTION_URL = serviceUrl(process.env.INGESTION_URL, 'http://localhost:3003');
const ALERT_URL = serviceUrl(process.env.ALERT_URL, 'http://localhost:3004');
const INSIGHT_URL = serviceUrl(process.env.INSIGHT_URL, 'http://localhost:3006');

// CORS_ORIGIN accepts comma-separated origins; unset allows all origins.
const allowedOrigins = originList(process.env.CORS_ORIGIN);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.warn('[boot] CORS_ORIGIN is not set — every origin is allowed. Set it in production.');
}

app.use(helmet());
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : true }));
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'api-gateway' }));

// Expose public service URLs so the browser can wake idle Render instances.
app.get('/upstreams', (req, res) => {
  res.json({ services: [AUTH_URL, DEVICE_REGISTRY_URL, INGESTION_URL, ALERT_URL, INSIGHT_URL] });
});

// Allow time for idle services to start before the proxy times out.
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 90 * 1000;

// Wait for cold upstreams before proxying; cache readiness per service.
const lastSeenUp = new Map();
const ASSUME_ASLEEP_AFTER_MS = 10 * 60 * 1000;

async function waitUntilAwake(target, prefix) {
  const last = lastSeenUp.get(target);
  if (last !== undefined && Date.now() - last < ASSUME_ASLEEP_AFTER_MS) return true;

  const deadline = Date.now() + UPSTREAM_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`${target}/health`, { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) {
        if (attempt > 1) console.log(`[gateway] ${prefix} awake after ${attempt} attempts`);
        lastSeenUp.set(target, Date.now());
        return true;
      }
    } catch {
      // Still starting, or refusing connections while it boots.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.error(`[gateway] ${prefix} never came up within ${UPSTREAM_TIMEOUT_MS}ms`);
  return false;
}

function upstream(target, prefix) {
  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    // pathRewrite adds the mount prefix back — Express strips it before the
    // proxy middleware sees req.url, so without this "/api/auth/login" arrives
    // here as just "/login" and the downstream service 404s.
    pathRewrite: (path) => `${prefix}${path}`,
    // Pass the caller's real IP through as X-Forwarded-For. auth-service's rate
    // limiter keys on it; without this every login attempt would look like it
    // came from the gateway and one user could lock out everyone else.
    xfwd: true,
    proxyTimeout: UPSTREAM_TIMEOUT_MS,
    timeout: UPSTREAM_TIMEOUT_MS,
    on: {
      error: (err, req, res) => {
        console.error(`[gateway] ${prefix} proxy error: ${err.code || err.message}`);
        // A failed attempt may itself have woken the service, so don't keep
        // treating it as up.
        lastSeenUp.delete(target);
        if (res.headersSent || typeof res.status !== 'function') return;
        res.status(502).json({ error: 'Upstream service unavailable', service: prefix });
      },
    },
  });

  return async (req, res, next) => {
    const awake = await waitUntilAwake(target, prefix);
    if (!awake) {
      return res.status(503).json({
        error: 'Upstream service is starting up and did not respond in time. Please retry.',
        service: prefix,
      });
    }
    return proxy(req, res, next);
  };
}

app.use('/api/auth', upstream(AUTH_URL, '/api/auth'));
app.use('/api/devices', upstream(DEVICE_REGISTRY_URL, '/api/devices'));
app.use('/api/telemetry', upstream(INGESTION_URL, '/api/telemetry'));
app.use('/api/alerts', upstream(ALERT_URL, '/api/alerts'));
app.use('/api/insights', upstream(INSIGHT_URL, '/api/insights'));

app.use((req, res) => res.status(404).json({ error: 'route not found' }));

function createAppServer() {
  if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
    return https.createServer(
      { key: fs.readFileSync(process.env.SSL_KEY_PATH), cert: fs.readFileSync(process.env.SSL_CERT_PATH) },
      app
    );
  }
  return http.createServer(app);
}

const server = createAppServer();
server.listen(PORT, () => {
  console.log(`[api-gateway] listening on :${PORT} (${process.env.SSL_KEY_PATH ? 'https' : 'http'})`);
});
