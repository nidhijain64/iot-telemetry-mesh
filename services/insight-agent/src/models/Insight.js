const mongoose = require('mongoose');

// One insight summarises a CLUSTER of alerts, not a single alert. A single
// "sound level above baseline" is already in the alert feed and adding a
// sentence to it would be noise; what is missing is what three of them in four
// minutes, plus a shake, together mean.
const insightSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },

    // The alerts this was derived from, so a reader can check the reasoning
    // against the evidence rather than taking the model's word for it.
    alertIds: [{ type: String }],
    alertCount: { type: Number, required: true },
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },

    headline: { type: String, required: true },
    likelyCause: { type: String, required: true },
    recommendedAction: { type: String, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], required: true },
    // The model's own confidence. Recorded rather than hidden, because a
    // low-confidence guess presented as fact is worse than no insight.
    confidence: { type: String, enum: ['low', 'medium', 'high'], required: true },

    model: { type: String, required: true },
  },
  { timestamps: true }
);

insightSchema.index({ deviceId: 1, createdAt: -1 });

module.exports = mongoose.model('Insight', insightSchema);
