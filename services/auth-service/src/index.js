require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { serviceUrl, originList } = require('./config/serviceUrl');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

if (!process.env.JWT_SECRET) {
  console.error('[boot] JWT_SECRET is not set — refusing to start');
  process.exit(1);
}

// CORS_ORIGIN accepts comma-separated origins; unset allows all origins.
const allowedOrigins = originList(process.env.CORS_ORIGIN);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.warn('[boot] CORS_ORIGIN is not set — every origin is allowed. Set it in production.');
}

// Trust one proxy hop so rate limits use the forwarded client IP.
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
