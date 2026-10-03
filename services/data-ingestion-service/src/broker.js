// ============================================================
// services/data-ingestion-service/src/broker.js
//
// Builds and returns a configured aedes instance. Does NOT create
// its own server or call .listen() — index.js attaches this to
// the same HTTP server Express uses, so REST and MQTT share one port.
// ============================================================

const aedesExports = require('aedes');
const Aedes = aedesExports.Aedes || aedesExports.default || aedesExports;
const mqemitterRedis = require('mqemitter-redis');
const aedesPersistenceRedis = require('aedes-persistence-redis');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const ringBuffer = require('./ringBuffer');
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

// Asks device-registry which devices this viewer may see, using the viewer's
// OWN token. That endpoint is already scoped (operators get their own devices,
// admins get the fleet), so ownership lives in exactly one place instead of
// being reimplemented — and differently — here.
async function fetchVisibleDeviceIds(token) {
  const { data } = await axios.get(`${DEVICE_REGISTRY_URL}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 3000,
  });
  return new Set(data.map((d) => d.deviceId));
}

// Aedes keeps its subscription emitter and its session/retained store in memory
// by default, and both are per-process. That is the reason this Deployment ran a
// single replica: a device connecting to replica A publishes into A's emitter
// only, so a dashboard holding its socket on replica B never sees that device at
// all — no error, just a device that silently isn't there.
//
// Pointing both at Redis makes the brokers one logical broker.
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
      client.visibleDeviceIds = new Set();

      try {
        client.visibleDeviceIds = await fetchVisibleDeviceIds(secretOrToken);
      } catch (err) {
        // Fail CLOSED — an empty set means this viewer sees nothing until a
        // refresh succeeds, rather than silently falling back to the whole fleet.
        console.error(`[broker] could not load device scope for ${decoded.sub}:`, err.message);
      }

      client.scopeRefresh = setInterval(async () => {
        try {
          client.visibleDeviceIds = await fetchVisibleDeviceIds(secretOrToken);
        } catch (err) {
          // Keep the previous set rather than widening or clearing it.
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

  aedes.authorizePublish = (client, packet, callback) => {
    if (client.isViewer) {
      return callback(new Error('viewers are not authorized to publish'));
    }
    const expectedTopic = `${TELEMETRY_PREFIX}${client.deviceId}`;
    if (packet.topic === expectedTopic) {
      return callback(null);
    }
    return callback(new Error(`not authorized to publish to ${packet.topic}`));
  };

  aedes.authorizeSubscribe = (client, sub, callback) => {
    if (client.isViewer) {
      return callback(null, sub);
    }
    return callback(new Error('devices are not authorized to subscribe'));
  };

  
  aedes.authorizeForward = (client, packet) => {
    if (!client || !client.isViewer) return packet;
    if (!packet.topic || !packet.topic.startsWith(TELEMETRY_PREFIX)) return null;

    const deviceId = packet.topic.slice(TELEMETRY_PREFIX.length);
    if (client.visibleDeviceIds && client.visibleDeviceIds.has(deviceId)) {
      return packet;
    }
    return null; // falsy return drops the message for this client only
  };

  aedes.on('publish', async (packet, client) => {
    // This guard is load-bearing once the emitter is shared. Every replica sees
    // every message on the Redis channel, but `client` is set only on the replica
    // the publisher is actually connected to — so the persist-and-check work below
    // runs exactly once per reading instead of once per replica. Without it,
    // scaling out would multiply Mongo writes and alert checks by the replica count.
    if (!client) return;
    if (!packet.topic.startsWith(TELEMETRY_PREFIX)) return;

    let reading;
    try {
      reading = JSON.parse(packet.payload.toString());
    } catch (err) {
      console.warn(`[broker] ignored non-JSON payload from ${client.deviceId}`);
      return;
    }

    const entry = { ...reading, deviceId: client.deviceId, receivedAt: new Date().toISOString() };
    // Awaited, unlike the two fire-and-forget calls below: the ring buffer backs
    // the dashboard's live chart, so letting the alert call overtake it would
    // surface an alert for a reading the chart has not drawn yet. push() handles
    // its own Redis failures and never rejects, so this adds latency, not risk.
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
    if (client.scopeRefresh) {
      clearInterval(client.scopeRefresh);
      client.scopeRefresh = null;
    }
    console.log(`[broker] client disconnected: ${client.id}`);
  });

  return aedes;
}

module.exports = { createBroker, fetchVisibleDeviceIds };
