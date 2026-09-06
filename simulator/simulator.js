// ============================================================
// simulator/simulator.js
//
// Self-provisioning: on startup, logs in as a real user, then for
// each simulated device either finds it already registered or
// registers it and issues credentials. Secrets are cached locally
// in device-secrets.json (gitignored) since device-registry-service
// only ever returns a secret once, at issuance time.
//
// Publishes temperature, humidity, and a slowly-draining battery
// level per device, with a small chance per tick of a real spike —
// so the alert system has something to actually catch during a
// live demo, not just in a one-off manual test.
// ============================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mqtt = require('mqtt');

const AUTH_URL = process.env.AUTH_URL || 'http://localhost:3001';
const DEVICE_REGISTRY_URL = process.env.DEVICE_REGISTRY_URL || 'http://localhost:3002';
const MQTT_WS_URL = process.env.MQTT_WS_URL || 'ws://localhost:3003';
const SIM_USERNAME = process.env.SIM_USERNAME;
const SIM_PASSWORD = process.env.SIM_PASSWORD;
const PUBLISH_INTERVAL_MS = Number(process.env.PUBLISH_INTERVAL_MS) || 5000;
const FLEET_SIZE = Number(process.env.FLEET_SIZE) || 3;

const SECRETS_FILE = path.join(__dirname, 'device-secrets.json');

function loadSecrets() {
  if (fs.existsSync(SECRETS_FILE)) {
    return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf-8'));
  }
  return {};
}

function saveSecrets(secrets) {
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2));
}

async function login() {
  const res = await axios.post(`${AUTH_URL}/api/auth/login`, {
    username: SIM_USERNAME,
    password: SIM_PASSWORD,
  });
  return res.data.token;
}

async function ensureDevice(token, deviceId, secrets) {
  const headers = { Authorization: `Bearer ${token}` };

  try {
    await axios.post(
      `${DEVICE_REGISTRY_URL}/api/devices`,
      { deviceId, label: `Simulated Device ${deviceId}`, type: 'simulator' },
      { headers }
    );
    console.log(`[simulator] registered ${deviceId}`);
  } catch (err) {
    if (err.response?.status !== 409) throw err; // 409 just means it already exists
  }

  if (secrets[deviceId]) {
    return secrets[deviceId];
  }

  const res = await axios.post(
    `${DEVICE_REGISTRY_URL}/api/devices/${deviceId}/credentials`,
    {},
    { headers }
  );
  secrets[deviceId] = res.data.secret;
  saveSecrets(secrets);
  console.log(`[simulator] issued new credentials for ${deviceId}`);
  return res.data.secret;
}

function randomWalk(current, min, max, step) {
  const next = current + (Math.random() - 0.5) * step * 2;
  return Math.max(min, Math.min(max, next));
}

function startDevicePublisher(deviceId, secret) {
  const client = mqtt.connect(MQTT_WS_URL, { username: deviceId, password: secret });

  let temperature = 22 + Math.random() * 5;
  let humidity = 45 + Math.random() * 10;
  let battery = 80 + Math.random() * 20;

  client.on('connect', () => {
    console.log(`[simulator] ${deviceId} connected`);

    setInterval(() => {
      temperature = randomWalk(temperature, 15, 45, 1.5);
      humidity = randomWalk(humidity, 20, 90, 3);
      battery = Math.max(0, battery - Math.random() * 0.3); // slow one-way drain, like a real unattended sensor

      // ~5% chance per tick of a real spike, so alert-rules-service has
      // something to actually catch during a demo.
      const isSpike = Math.random() < 0.05;

      const reading = {
        temperature: isSpike
          ? Math.round((38 + Math.random() * 4) * 10) / 10
          : Math.round(temperature * 10) / 10,
        humidity: Math.round(humidity * 10) / 10,
        batteryLevel: Math.round(battery),
        source: 'simulator',
      };

      client.publish(`telemetry/${deviceId}`, JSON.stringify(reading));
    }, PUBLISH_INTERVAL_MS);
  });

  client.on('error', (err) => {
    console.error(`[simulator] ${deviceId} error:`, err.message);
  });
}

async function main() {
  if (!SIM_USERNAME || !SIM_PASSWORD) {
    console.error('[simulator] SIM_USERNAME and SIM_PASSWORD must be set in .env');
    process.exit(1);
  }

  const token = await login();
  const secrets = loadSecrets();

  for (let i = 1; i <= FLEET_SIZE; i++) {
    const deviceId = `sim-${String(i).padStart(2, '0')}`;
    const secret = await ensureDevice(token, deviceId, secrets);
    startDevicePublisher(deviceId, secret);
  }

  console.log(`[simulator] running ${FLEET_SIZE} device(s), publishing every ${PUBLISH_INTERVAL_MS}ms`);
}

main().catch((err) => {
  console.error('[simulator] fatal error:', err.message);
  process.exit(1);
});
