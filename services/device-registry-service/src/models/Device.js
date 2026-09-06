const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, unique: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: ['simulator', 'mobile-browser', 'physical-sensor'], required: true },

    // Authorization / lifecycle — admin-controlled only, via PATCH /:deviceId/status.
    status: { type: String, enum: ['pending', 'active', 'decommissioned'], default: 'pending' },

    // Liveness — separate concern, set only by heartbeat + the stale-device sweep.
    isOnline: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },

    // Device credentials — for MQTT broker authentication, NOT a user JWT.
    // Only the bcrypt hash is ever stored; the plaintext secret is returned
    // exactly once, at issuance time, and never again.
    credentialHash: { type: String, default: null },
    credentialIssuedAt: { type: Date, default: null },

    registeredBy: { type: String, required: true },
  },
  { timestamps: true }
);

// Matches GET /api/devices exactly: Device.find({ registeredBy }).sort({ createdAt: -1 }).
// Without it every device list is a full collection scan plus an in-memory sort.
deviceSchema.index({ registeredBy: 1, createdAt: -1 });

module.exports = mongoose.model('Device', deviceSchema);
