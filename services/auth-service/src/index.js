require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const http = require('http');
const https = require('https');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

if (!process.env.JWT_SECRET) {
  console.error('[boot] JWT_SECRET is not set — refusing to start');
  process.exit(1);
}

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

// Requests arrive through the api-gateway, so the socket address is always the
// gateway's. Trusting exactly one proxy hop makes req.ip the real client IP
// from X-Forwarded-For — without this the rate limiter would count every user
// into a single bucket and lock out the whole system after ten bad passwords.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : true }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'auth-service' }));
app.use('/api/auth', authRoutes);

app.use((req, res) => res.status(404).json({ error: 'route not found' }));
app.use((err, req, res, next) => {
  console.error('[unhandled]', err.message);
  const status = err.status || err.statusCode || 500;
  const message = err.expose ? err.message : 'internal server error';
  res.status(status).json({ error: message });
});

// Optional HTTPS — used only when SSL_KEY_PATH/SSL_CERT_PATH are set
// (needed so a real phone browser can reach this over the network;
// falls back to plain HTTP for ordinary localhost testing).
function createAppServer() {
  if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
    return https.createServer(
      { key: fs.readFileSync(process.env.SSL_KEY_PATH), cert: fs.readFileSync(process.env.SSL_CERT_PATH) },
      app
    );
  }
  return http.createServer(app);
}

connectDB().then(() => {
  const server = createAppServer();
  server.listen(PORT, () => {
    console.log(`[auth-service] listening on :${PORT} (${process.env.SSL_KEY_PATH ? 'https' : 'http'})`);
  });
});
