const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true },
    type: { type: String, required: true }, // 'high-temperature' | 'low-battery' | 'sound-anomaly'
    severity: { type: String, enum: ['warning', 'critical'], required: true },
    value: { type: Number, required: true },
    message: { type: String, required: true },
  },
  { timestamps: true }
);

// Matches GET /api/alerts: filter by deviceId ($in the caller's devices), newest
// first. The sort alone would otherwise scan and sort the whole collection.
alertSchema.index({ deviceId: 1, createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
