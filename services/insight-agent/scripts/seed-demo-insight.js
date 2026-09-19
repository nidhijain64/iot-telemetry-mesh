// Writes a placeholder insight so the dashboard panel can be built and demoed
// without spending a model call — and so the UI can still be shown when the
// Groq key is missing or rejected.
//
//   node scripts/seed-demo-insight.js sim-03
//   node scripts/seed-demo-insight.js --clear
//
// The model field is recorded as "stub (not generated)" on purpose: an insight
// in the database should always say where its text came from, and a hand-written
// one must never be mistaken for something the model actually produced.
require('dotenv').config();
const mongoose = require('mongoose');
const Insight = require('../src/models/Insight');

const STUB_MODEL = 'stub (not generated)';

const args = process.argv.slice(2);
const clear = args.includes('--clear');
const deviceId = args.find((a) => !a.startsWith('--')) || 'sim-03';

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log(`[seed] connected — ${mongoose.connection.name}`);

  if (clear) {
    const { deletedCount } = await Insight.deleteMany({ model: STUB_MODEL });
    console.log(`[seed] removed ${deletedCount} stub insight(s) — real ones left untouched`);
    return;
  }

  const now = new Date();
  const doc = await Insight.create({
    deviceId,
    alertIds: [],
    alertCount: 5,
    windowStart: new Date(now.getTime() - 12 * 60 * 1000),
    windowEnd: now,
    headline: 'Temperature climbing while battery drains',
    likelyCause:
      'Five alerts in twelve minutes show temperature rising from 41°C to 47.5°C while battery fell from 18% to 9%. That pairing usually means the device is charging in an enclosure with no airflow, so heat builds up faster than it can dissipate.',
    recommendedAction:
      'Check the enclosure for blocked vents and move the device off charge until it cools below 40°C. If the pattern repeats after cooling, the battery itself is the more likely fault.',
    severity: 'high',
    confidence: 'medium',
    model: STUB_MODEL,
  });

  console.log(`[seed] wrote stub insight for ${deviceId} (${doc._id})`);
  console.log('[seed] remove it later with: node scripts/seed-demo-insight.js --clear');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
