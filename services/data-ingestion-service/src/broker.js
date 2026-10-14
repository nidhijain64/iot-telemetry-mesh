// Configure Aedes; index.js attaches it to the shared HTTP server.

const aedesExports = require('aedes');
const Aedes = aedesExports.Aedes || aedesExports.default || aedesExports;
const mqemitterRedis = require('mqemitter-redis');
const aedesPersistenceRedis = require('aedes-persistence-redis');
const axios = require('axios');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const ringBuffer = require('./ringBuffer');
const { validateReading } = require('./validateReading');
const Reading = require('./models/Reading');
const { reportSeen } = require('./liveness');

const { serviceUrl } = require('./config/serviceUrl');
const redis = require('./config/redis');

const DEVICE_REGISTRY_URL = serviceUrl(process.env.DEVICE_REGISTRY_URL, 'http://localhost:3002');
const ALERT_SERVICE_URL = serviceUrl(process.env.ALERT_SERVICE_URL, 'http://localhost:3004');
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

// How often a connected viewer's owned-device set is refreshed, so a device
// registered after the dashboard connected starts streaming without a reload.
const VIEWER_SCOPE_REFRESH_MS = Number(process.env.VIEWER_SCOPE_REFRESH_MS) || 30 * 1000;

const TELEMETRY_PREFIX = 'telemetry/';

// Use the viewer's JWT to fetch their allowed devices from the registry.
async function fetchVisibleDeviceIds(token) {
  const { data } = await axios.get(`${DEVICE_REGISTRY_URL}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 3000,
  });
  return new Set(data.map((d) => d.deviceId));
}

// Share the emitter and session store through Redis so viewers receive messages across replicas.
function brokerOptions() {
  if (!redis.isEnabled()) return {};

  return {
    // mqemitter-redis takes the URL as-is; it opens its own pub and sub
    // connections, because a connection in subscriber mode cannot also publish.
    mq: mqemitterRedis({ connectionString: process.env.REDIS_URL }),
    // The Aedes persistence package wants ioredis options rather than a URL.
    persistence: aedesPersistenceRedis(redis.connectionOptions()),
  };
}

async function createBroker() {
  const aedes = await Aedes.createBroker(brokerOptions());

  aedes.authenticate = async (client, username, password, callback) => {
    if (!username || !password) {
      console.warn('[broker] rejected connection — missing username/password');
      return callback(null, false);
    }
    const name = username.toString();
    const secretOrToken = password.toString();

    if (name === 'dashboard') {
      let decoded;
      try {
        decoded = jwt.verify(secretOrToken, JWT_SECRET, { algorithms: ['HS256'] });
      } catch (err) {
        console.warn('[broker] rejected viewer — invalid token:', err.message);
        return callback(null, false);
      }

      // A viewer's identity has to survive past this callback: authorizeForward
      // runs per delivered message and is synchronous, so the set of devices
      // this viewer may see must already be resolved and cached by then.
      client.isViewer = true;
      client.deviceId = null;
      client.userId = decoded.sub;
      client.tokenExpiresAt = decoded.exp * 1000;
      if (!Number.isFinite(client.tokenExpiresAt)) return callback(null, false);
      client.visibleDeviceIds = new Set();

      try {
        client.visibleDeviceIds = await fetchVisibleDeviceIds(secretOrToken);
      } catch (err) {
        // Fail CLOSED — an empty set means this viewer sees nothing until a
        // refresh succeeds, rather than silently falling back to the whole fleet.
        console.error(`[broker] could not load device scope for ${decoded.sub}:`, err.message);
      }

      if (Date.now() >= client.tokenExpiresAt) return callback(null, false);
      client.expiryTimer = setTimeout(() => client.close(), Math.min(client.tokenExpiresAt - Date.now(), 2147483647));
      client.scopeRefresh = setInterval(async () => {
        try {
          client.visibleDeviceIds = await fetchVisibleDeviceIds(secretOrToken);
        } catch (err) {
          client.visibleDeviceIds = new Set();
          if ([401, 403].includes(err.response?.status)) client.close();
          // Fail closed until a subsequent refresh succeeds.
          console.warn(`[broker] scope refresh failed for ${decoded.sub}: ${err.message}`);
        }
      }, VIEWER_SCOPE_REFRESH_MS);

      console.log(
        `[broker] authenticated viewer ${decoded.username} — ${client.visibleDeviceIds.size} device(s) in scope`
      );
      return callback(null, true);
    }

    try {
      const response = await axios.post(
        `${DEVICE_REGISTRY_URL}/api/devices/${name}/verify-credentials`,
        { secret: secretOrToken },
        { headers: { 'x-service-key': INTERNAL_SERVICE_KEY }, timeout: 3000 }
      );
      if (response.data && response.data.valid) {
        client.deviceId = name;
        client.deviceSecret = secretOrToken;
        client.deviceType = response.data.type;
        client.isViewer = false;
        console.log(`[broker] authenticated device: ${name}`);
        return callback(null, true);
      }
      console.warn(`[broker] rejected — invalid credentials for ${name}`);
      return callback(null, false);
    } catch (err) {
      console.error(`[broker] could not verify ${name}:`, err.message);
      return callback(null, false);
    }
  };

  aedes.authorizePublish = async (client, packet, callback) => {
    try {
      if (client.isViewer || packet.topic !== `${TELEMETRY_PREFIX}${client.deviceId}`) throw new Error('publish not authorized');
      const reading = validateReading(packet.payload);
      if (reading.source !== client.deviceType) throw new Error('source does not match registered device');
      // Check current credentials and lifecycle on every publish, including established sessions.
      const { data } = await axios.post(`${DEVICE_REGISTRY_URL}/api/devices/${encodeURIComponent(client.deviceId)}/verify-credentials`,
        { secret: client.deviceSecret }, { headers: { 'x-service-key': INTERNAL_SERVICE_KEY }, timeout: 3000 });
      if (!data.valid) throw new Error('device access revoked');
      packet.payload = Buffer.from(JSON.stringify({ ...reading, readingId: randomUUID(), receivedAt: new Date().toISOString() }));
      callback(null);
    } catch (err) {
      callback(new Error('publish rejected: ' + err.message));
    }
  };

  aedes.authorizeSubscribe = (client, sub, callback) => {
    if (client.isViewer) {
      return callback(null, sub);
    }
    return callback(new Error('devices are not authorized to subscribe'));
  };

  // Check ownership for every delivery: wildcard subscriptions alone cannot enforce device access.
  aedes.authorizeForward = (client, packet) => {
    if (!client || !client.isViewer) return packet;
    if (client.tokenExpiresAt !== undefined && Date.now() >= client.tokenExpiresAt) return null;
    if (!packet.topic || !packet.topic.startsWith(TELEMETRY_PREFIX)) return null;

    const deviceId = packet.topic.slice(TELEMETRY_PREFIX.length);
    if (client.visibleDeviceIds && client.visibleDeviceIds.has(deviceId)) {
      return packet;
    }
    return null; // falsy return drops the message for this client only
  };

  aedes.on('publish', async (packet, client) => {
    // Only the publisher's replica has a client; other replicas must not persist or check the reading again.
    if (!client) return;
    if (!packet.topic.startsWith(TELEMETRY_PREFIX)) return;

    let reading;
    try {
      reading = JSON.parse(packet.payload.toString());
    } catch (err) {
      console.warn(`[broker] ignored non-JSON payload from ${client.deviceId}`);
      return;
    }

    const entry = { ...reading, deviceId: client.deviceId };
    // Update the live buffer before triggering alerts for this reading.
    await ringBuffer.push(client.deviceId, entry);

    // Marks the device alive in the registry. Fire-and-forget and throttled
    // internally — liveness bookkeeping must never delay or drop a reading.
    reportSeen(client.deviceId);

    // Fire-and-forget, same as the alert-service call below — one slow or
    // failed write must never stall or drop the next incoming reading.
    Reading.create(entry).catch((err) => {
      console.warn(`[broker] could not persist reading from ${client.deviceId}: ${err.message}`);
    });

    try {
      await axios.post(`${ALERT_SERVICE_URL}/api/alerts/check`, entry, {
        headers: { 'x-service-key': INTERNAL_SERVICE_KEY },
        timeout: 2000,
      });
    } catch (err) {
      console.warn(`[broker] could not reach alert-rules-service: ${err.message}`);
    }
  });

  aedes.on('client', (client) => {
    console.log(`[broker] client connected: ${client.id}`);
  });

  aedes.on('clientDisconnect', (client) => {
    // The refresh timer holds a reference to the client — without this, every
    // dashboard tab that ever connected keeps polling device-registry forever.
    clearTimeout(client.expiryTimer);
    client.deviceSecret = null;
    if (client.scopeRefresh) {
      clearInterval(client.scopeRefresh);
      client.scopeRefresh = null;
    }
    console.log(`[broker] client disconnected: ${client.id}`);
  });

  return aedes;
}

module.exports = { createBroker, fetchVisibleDeviceIds };
