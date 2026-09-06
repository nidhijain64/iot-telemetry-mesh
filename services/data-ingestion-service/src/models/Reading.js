const mongoose = require('mongoose');

// Permanent history of every telemetry message that passed broker auth.
// The ring buffer (ringBuffer.js) stays as the fast in-memory path for the
// dashboard's "live" view — this is the durable record behind it.
const readingSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    source: { type: String, enum: ['simulator', 'mobile-browser'], required: true },

    temperature: { type: Number, default: null },
    humidity: { type: Number, default: null },
    batteryLevel: { type: Number, default: null },
    soundLevel: { type: Number, default: null },
    location: {
      lat: { type: Number },
      lng: { type: Number },
    },
    motion: {
      x: { type: Number },
      y: { type: Number },
      z: { type: Number },
    },

    receivedAt: { type: Date, required: true },
  },
  { timestamps: false }
);

readingSchema.index({ deviceId: 1, receivedAt: -1 });

module.exports = mongoose.model('Reading', readingSchema);
