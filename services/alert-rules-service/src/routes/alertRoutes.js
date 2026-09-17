const express = require('express');
const axios = require('axios');
const Alert = require('../models/Alert');
const { verifyToken } = require('../middleware/verifyToken');
const { checkReading } = require('../checkEngine');

const router = express.Router();
const { serviceUrl } = require('../config/serviceUrl');

const DEVICE_REGISTRY_URL = serviceUrl(process.env.DEVICE_REGISTRY_URL, 'http://localhost:3002');

// INTERNAL ONLY — called by data-ingestion-service on every message, not a
// human request. Gated by the shared service key (same pattern as
// device-registry's /verify-credentials), not a user JWT: there's no
// logged-in human in this call, so a device shouldn't be able to hit this
// directly and inject fabricated alerts/webhooks.
router.post('/check', async (req, res) => {
  const serviceKey = req.headers['x-service-key'];
  if (!serviceKey || serviceKey !== process.env.INTERNAL_SERVICE_KEY) {
    return res.status(401).json({ error: 'invalid or missing service key' });
  }
  try {
    const fired = await checkReading(req.body);
    return res.json({ alertsFired: fired.length });
  } catch (err) {
    console.error('[alerts/check]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

// INTERNAL ONLY — the insight agent reads raw alerts across every device, so it
// cannot use the scoped human endpoint below. Gated by the shared service key,
// same as /check: there is no logged-in human in this call, and handing unscoped
// alerts to a user token would break the tenant boundary the scoped endpoint
// exists to enforce.
router.get('/internal/recent', async (req, res) => {
  const serviceKey = req.headers['x-service-key'];
  if (!serviceKey || serviceKey !== process.env.INTERNAL_SERVICE_KEY) {
    return res.status(401).json({ error: 'invalid or missing service key' });
  }
  try {
    const filter = {};
    if (req.query.since) {
      const since = new Date(req.query.since);
      if (Number.isNaN(since.getTime())) {
        return res.status(400).json({ error: 'since must be an ISO-8601 date' });
      }
      filter.createdAt = { $gte: since };
    }
    // Oldest first: the agent reads a cluster as a sequence, and sorting once
    // here saves every caller doing it.
    const alerts = await Alert.find(filter).sort({ createdAt: 1 }).limit(500).lean();
    return res.json(alerts);
  } catch (err) {
    console.error('[alerts/internal/recent]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

// Human/dashboard-facing — recent alert history. Alert has no owner field
// of its own, so scoping reuses device-registry's already-scoped device
// list: forward the caller's own JWT there, get back only the devices
// they're allowed to see, and filter alerts to that set. Admins keep
// seeing everything, same as the device list.
router.get('/', verifyToken, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role !== 'admin') {
      const { data: devices } = await axios.get(`${DEVICE_REGISTRY_URL}/api/devices`, {
        headers: { Authorization: req.headers.authorization },
        timeout: 3000,
      });
      filter = { deviceId: { $in: devices.map((d) => d.deviceId) } };
    }
    const alerts = await Alert.find(filter).sort({ createdAt: -1 }).limit(100);
    return res.json(alerts);
  } catch (err) {
    console.error('[alerts/list]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

module.exports = router;
