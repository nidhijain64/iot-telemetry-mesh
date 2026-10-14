require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { WebSocketServer, createWebSocketStream } = require('ws');
const { serviceUrl, originList } = require('./config/serviceUrl');
const connectDB = require('./config/db');
const { verifyToken } = require('./middleware/verifyToken');
const ringBuffer = require('./ringBuffer');
const { createBroker } = require('./broker');
const Reading = require('./models/Reading');

const app = express();
const PORT = process.env.PORT || 3003;
const DEVICE_REGISTRY_URL = serviceUrl(process.env.DEVICE_REGISTRY_URL, 'http://localhost:3002');
const MAX_HISTORY_LIMIT = 1000;
const DEFAULT_HISTORY_LIMIT = 200;

if (!process.env.JWT_SECRET) {
  console.error('[boot] JWT_SECRET is not set — refusing to start');
  process.exit(1);
}
if (!process.env.INTERNAL_SERVICE_KEY) {
  console.error('[boot] INTERNAL_SERVICE_KEY is not set — refusing to start');
  process.exit(1);
}

// CORS_ORIGIN accepts comma-separated origins; unset allows all origins.
const allowedOrigins = originList(process.env.CORS_ORIGIN);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.warn('[boot] CORS_ORIGIN is not set — every origin is allowed. Set it in production.');
}

app.use(helmet());
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : true }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'data-ingestion-service' }));

// Delegate ownership checks to device-registry using the caller's JWT.
// Returns false after sending an error response.
async function assertDeviceVisible(req, res) {
  try {
    await axios.get(`${DEVICE_REGISTRY_URL}/api/devices/${req.params.deviceId}`, {
      headers: { Authorization: req.headers.authorization },
      timeout: 3000,
    });
    return true;
  } catch (err) {
    if (err.response?.status === 404) {
      res.status(404).json({ error: 'device not found' });
    } else {
      console.error('[telemetry] could not verify device ownership:', err.message);
      res.status(502).json({ error: 'could not verify device ownership' });
    }
    return false;
  }
}

// Recent readings are a cache; use /history for durable MongoDB records.
app.get('/api/telemetry/:deviceId/recent', verifyToken, async (req, res) => {
  if (!(await assertDeviceVisible(req, res))) return;
  res.json(await ringBuffer.getRecent(req.params.deviceId));
});

// Durable history, straight out of MongoDB. Every reading that passed broker
// auth has been written to the Reading collection all along; this is what
// finally reads it back, so history survives a restart of this service.
app.get('/api/telemetry/:deviceId/history', verifyToken, async (req, res) => {
  if (!(await assertDeviceVisible(req, res))) return;

  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isNaN(parsedLimit)
    ? DEFAULT_HISTORY_LIMIT
    : Math.min(Math.max(parsedLimit, 1), MAX_HISTORY_LIMIT);

  const query = { deviceId: req.params.deviceId };
  if (req.query.since) {
    const since = new Date(req.query.since);
    if (Number.isNaN(since.getTime())) {
      return res.status(400).json({ error: 'since must be an ISO-8601 date' });
    }
    query.receivedAt = { $gte: since };
  }

  try {
    // Sorted newest-first to use the { deviceId, receivedAt: -1 } index, then
    // reversed so callers (and charts) get oldest-first chronological order.
    const readings = await Reading.find(query).sort({ receivedAt: -1 }).limit(limit).lean();
    return res.json(readings.reverse());
  } catch (err) {
    console.error('[telemetry/history]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'route not found' }));
app.use((err, req, res, next) => {
  console.error('[unhandled]', err.message);
  const status = err.status || err.statusCode || 500;
  const message = err.expose ? err.message : 'internal server error';
  res.status(status).json({ error: message });
});

function createAppServer() {
  if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
    return https.createServer(
      { key: fs.readFileSync(process.env.SSL_KEY_PATH), cert: fs.readFileSync(process.env.SSL_CERT_PATH) },
      app
    );
  }
  return http.createServer(app);
}

async function start() {
  await connectDB();
  const aedes = await createBroker();
  const server = createAppServer();

  // Share the HTTP server with MQTT over WebSockets.
  // Keep raw Buffer chunks: text encoding corrupts MQTT packet framing.
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    const stream = createWebSocketStream(ws);
    aedes.handle(stream);
  });

  server.listen(PORT, () => {
    const scheme = process.env.SSL_KEY_PATH ? 'https/wss' : 'http/ws';
    console.log(`[data-ingestion-service] REST + MQTT listening on :${PORT} (${scheme})`);
  });
}

start().catch((err) => {
  console.error('[boot] failed to start:', err.message);
  process.exit(1);
});
