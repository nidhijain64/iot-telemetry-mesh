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

// Comma-separated allowlist, e.g. "https://fleet.example.com,http://localhost:5173".
// Left unset it reflects any origin, which is fine on localhost but means any
// site a logged-in user visits could call this API from their browser — so an
// unset value in production is a real hole, and boot says so out loud.
const allowedOrigins = originList(process.env.CORS_ORIGIN);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.warn('[boot] CORS_ORIGIN is not set — every origin is allowed. Set it in production.');
}

app.use(helmet());
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : true }));
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'api-gateway' }));

// On a free hosting plan an idle service is suspended and takes ~30-60s to come
// back on the first request. The default proxy timeout is shorter than that, so
// the very first call after a quiet period failed with a bare 502 even though
// the upstream was waking up perfectly normally — and only a retry succeeded.
// Waiting it out costs nothing when services are warm.
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 90 * 1000;

function upstream(target, prefix) {
  return createProxyMiddleware({
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
        console.error(`[gateway] ${prefix} upstream failed: ${err.code || err.message}`);
        if (res.headersSent || typeof res.status !== 'function') return;
        // A timeout here almost always means the upstream is still waking, which
        // is worth telling the caller apart from the service being genuinely down.
        const waking = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
        res.status(waking ? 504 : 502).json({
          error: waking
            ? 'Upstream service is starting up — please retry in a moment.'
            : 'Upstream service unavailable',
          service: prefix,
        });
      },
    },
  });
}

app.use('/api/auth', upstream(AUTH_URL, '/api/auth'));
app.use('/api/devices', upstream(DEVICE_REGISTRY_URL, '/api/devices'));
app.use('/api/telemetry', upstream(INGESTION_URL, '/api/telemetry'));
app.use('/api/alerts', upstream(ALERT_URL, '/api/alerts'));

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
