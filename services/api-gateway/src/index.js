require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3005;

const AUTH_URL = process.env.AUTH_URL || 'http://localhost:3001';
const DEVICE_REGISTRY_URL = process.env.DEVICE_REGISTRY_URL || 'http://localhost:3002';
const INGESTION_URL = process.env.INGESTION_URL || 'http://localhost:3003';
const ALERT_URL = process.env.ALERT_URL || 'http://localhost:3004';

// Comma-separated allowlist, e.g. "https://fleet.example.com,http://localhost:5173".
// Left unset it reflects any origin, which is fine on localhost but means any
// site a logged-in user visits could call this API from their browser — so an
// unset value in production is a real hole, and boot says so out loud.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.warn('[boot] CORS_ORIGIN is not set — every origin is allowed. Set it in production.');
}

app.use(helmet());
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : true }));
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'api-gateway' }));

// pathRewrite adds each mount prefix back — Express strips it before the
// proxy middleware sees req.url, so without this, "/api/auth/login"
// arrives here as just "/login" and the downstream service 404s.
app.use('/api/auth', createProxyMiddleware({
  target: AUTH_URL,
  changeOrigin: true,
  // Pass the caller's real IP through as X-Forwarded-For. auth-service's rate
  // limiter keys on it; without this every login attempt looks like it came
  // from the gateway.
  xfwd: true,
  pathRewrite: (path) => `/api/auth${path}`,
}));
app.use('/api/devices', createProxyMiddleware({
  target: DEVICE_REGISTRY_URL,
  changeOrigin: true,
  pathRewrite: (path) => `/api/devices${path}`,
}));
app.use('/api/telemetry', createProxyMiddleware({
  target: INGESTION_URL,
  changeOrigin: true,
  pathRewrite: (path) => `/api/telemetry${path}`,
}));
app.use('/api/alerts', createProxyMiddleware({
  target: ALERT_URL,
  changeOrigin: true,
  pathRewrite: (path) => `/api/alerts${path}`,
}));

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
