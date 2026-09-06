const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const Device = require('../models/Device');
const { verifyToken, requireRole } = require('../middleware/verifyToken');

const router = express.Router();

const VALID_TYPES = ['simulator', 'mobile-browser', 'physical-sensor'];
const VALID_STATUSES = ['pending', 'active', 'decommissioned'];

router.post('/', verifyToken, async (req, res) => {
  try {
    const { deviceId, label, type } = req.body;
    if (!deviceId || !label || !type) {
      return res.status(400).json({ error: 'deviceId, label, and type are required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    const existing = await Device.findOne({ deviceId });
    if (existing) return res.status(409).json({ error: 'deviceId already registered' });

    const device = await Device.create({ deviceId, label, type, registeredBy: req.user.sub });
    return res.status(201).json(device);
  } catch (err) {
    console.error('[devices/register]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

// Each operator only sees devices they registered — this is the actual
// data boundary behind "different login, different dashboard". Admins
// see the whole fleet, matching their role's cross-device authority
// elsewhere (PATCH /status).
router.get('/', verifyToken, async (req, res) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { registeredBy: req.user.sub };
    const devices = await Device.find(filter).sort({ createdAt: -1 });
    return res.json(devices);
  } catch (err) {
    console.error('[devices/list]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.get('/:deviceId', verifyToken, async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    // 404, not 403, for someone else's device — same response as "doesn't
    // exist" so a probe can't tell the two apart.
    if (!device || (device.registeredBy !== req.user.sub && req.user.role !== 'admin')) {
      return res.status(404).json({ error: 'device not found' });
    }
    return res.json(device);
  } catch (err) {
    console.error('[devices/get]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.patch('/:deviceId/status', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      { status },
      { new: true }
    );
    if (!device) return res.status(404).json({ error: 'device not found' });
    return res.json(device);
  } catch (err) {
    console.error('[devices/status]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.post('/:deviceId/heartbeat', verifyToken, async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    // Owner-or-admin, matching GET /:deviceId and /credentials. Without it any
    // logged-in user could keep someone else's device looking alive — or flip a
    // device they've never seen to online — just by guessing its deviceId.
    if (!device || (device.registeredBy !== req.user.sub && req.user.role !== 'admin')) {
      return res.status(404).json({ error: 'device not found' });
    }
    if (device.status === 'decommissioned') {
      return res.status(403).json({ error: 'device is decommissioned — heartbeat rejected' });
    }
    device.isOnline = true;
    device.lastSeenAt = new Date();
    await device.save();
    return res.json(device);
  } catch (err) {
    console.error('[devices/heartbeat]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

// POST /:deviceId/credentials — issue (or reissue) a device secret.
// Returned in PLAINTEXT exactly once; only the bcrypt hash is stored.
// Owner-or-admin only — without this check, any logged-in user could
// reissue ANY device's secret by guessing its deviceId and silently
// take over a device that belongs to someone else.
router.post('/:deviceId/credentials', verifyToken, async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device || (device.registeredBy !== req.user.sub && req.user.role !== 'admin')) {
      return res.status(404).json({ error: 'device not found' });
    }

    const secret = crypto.randomBytes(24).toString('hex');
    device.credentialHash = await bcrypt.hash(secret, 12);
    device.credentialIssuedAt = new Date();
    await device.save();

    // Only time this plaintext value is ever returned — the caller (you,
    // or the simulator/mobile-node setup) must save it now.
    return res.status(201).json({
      deviceId: device.deviceId,
      secret,
      warning: 'Store this now — it cannot be retrieved again, only reissued.',
    });
  } catch (err) {
    console.error('[devices/credentials]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

// POST /:deviceId/seen — INTERNAL ONLY, called by data-ingestion-service each
// time a device publishes. Liveness is DERIVED from the data path rather than
// self-reported: a device that is publishing is by definition alive, and this
// works for anything that can reach the broker, including hardware that never
// speaks REST. Gated by the shared service key for the same reason
// /verify-credentials is — there's no logged-in human behind the call.
router.post('/:deviceId/seen', async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'];
    if (!serviceKey || serviceKey !== process.env.INTERNAL_SERVICE_KEY) {
      return res.status(401).json({ error: 'invalid or missing service key' });
    }

    // Same rule the stale sweep follows: touch liveness, never status. Matching
    // on status here (rather than reading, checking, then writing) also keeps a
    // decommission that lands mid-publish from being undone by this write.
    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId, status: { $ne: 'decommissioned' } },
      { isOnline: true, lastSeenAt: new Date() },
      { new: true }
    );
    if (!device) return res.status(404).json({ error: 'device not found or decommissioned' });

    return res.json({
      deviceId: device.deviceId,
      isOnline: device.isOnline,
      lastSeenAt: device.lastSeenAt,
    });
  } catch (err) {
    console.error('[devices/seen]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

// POST /:deviceId/verify-credentials — INTERNAL ONLY, called by
// data-ingestion-service's MQTT authenticate hook. Gated by a static
// shared key, not a user JWT — there's no logged-in human in this call,
// so stretching the JWT system to cover it would blur what it's for.
router.post('/:deviceId/verify-credentials', async (req, res) => {
  try {
    const serviceKey = req.headers['x-service-key'];
    if (!serviceKey || serviceKey !== process.env.INTERNAL_SERVICE_KEY) {
      return res.status(401).json({ error: 'invalid or missing service key' });
    }

    const { secret } = req.body;
    if (!secret) return res.status(400).json({ error: 'secret is required' });

    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device || !device.credentialHash || device.status === 'decommissioned') {
      return res.status(401).json({ valid: false });
    }

    const match = await bcrypt.compare(secret, device.credentialHash);
    if (!match) return res.status(401).json({ valid: false });

    return res.json({ valid: true, deviceId: device.deviceId, type: device.type });
  } catch (err) {
    console.error('[devices/verify-credentials]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

module.exports = router;
