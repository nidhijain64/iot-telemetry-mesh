const express = require('express');
const axios = require('axios');
const Alert = require('../models/Alert');
const { verifyToken } = require('../middleware/verifyToken');
const { checkReading } = require('../checkEngine');

const router = express.Router();
const { serviceUrl } = require('../config/serviceUrl');

const DEVICE_REGISTRY_URL = serviceUrl(process.env.DEVICE_REGISTRY_URL, 'http://localhost:3002');

// Internal ingestion endpoint; require the service key to prevent forged alerts.
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

// Internal agent endpoint; unscoped alerts require the service key.
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

// Filter alerts using the caller's allowed device list. Admins see all alerts.
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
