// Seeds a realistic burst of alerts so the insight-agent has something to
// triage on demand, instead of waiting for a real device to actually misbehave.
//
//   node scripts/seed-demo-alerts.js                 # default device, default story
//   node scripts/seed-demo-alerts.js sim-02 cooling  # pick device and story
//   node scripts/seed-demo-alerts.js --clear         # remove seeded alerts
//
// The agent clusters per device and needs INSIGHT_MIN_ALERTS (3) inside its
// INSIGHT_WINDOW_MS (15 min) window, so every alert is stamped within the last
// few minutes. It also skips a device it explained in the last 30 minutes —
// to demo repeatedly, run the agent with INSIGHT_COOLDOWN_MS=0.
require('dotenv').config();
const mongoose = require('mongoose');
const Alert = require('../src/models/Alert');

// Each story is a plausible failure with a cause worth naming, rather than
// random values — the point is to see whether the model reads the pattern.
const STORIES = {
  // Temperature climbing while the battery drains: the classic signature of a
  // device stuck charging in an enclosure with no airflow.
  thermal: [
    { minutesAgo: 11, type: 'high-temperature', severity: 'warning', value: 41.2, message: 'Temperature 41.2°C above threshold 40°C' },
    { minutesAgo: 8, type: 'high-temperature', severity: 'warning', value: 43.8, message: 'Temperature 43.8°C above threshold 40°C' },
    { minutesAgo: 5, type: 'low-battery', severity: 'warning', value: 18, message: 'Battery at 18%' },
    { minutesAgo: 3, type: 'high-temperature', severity: 'critical', value: 47.5, message: 'Temperature 47.5°C above threshold 40°C' },
    { minutesAgo: 1, type: 'low-battery', severity: 'critical', value: 9, message: 'Battery at 9%' },
  ],
  // Sound spikes on a regular cadence — reads as machinery rather than noise.
  cooling: [
    { minutesAgo: 12, type: 'sound-anomaly', severity: 'warning', value: 78.4, message: 'Sound level 78.4 dB, 3.1σ above baseline' },
    { minutesAgo: 9, type: 'sound-anomaly', severity: 'warning', value: 81.0, message: 'Sound level 81.0 dB, 3.6σ above baseline' },
    { minutesAgo: 6, type: 'sound-anomaly', severity: 'critical', value: 88.2, message: 'Sound level 88.2 dB, 4.9σ above baseline' },
    { minutesAgo: 2, type: 'high-temperature', severity: 'warning', value: 40.9, message: 'Temperature 40.9°C above threshold 40°C' },
  ],
};

const args = process.argv.slice(2);
const clear = args.includes('--clear');
const positional = args.filter((a) => !a.startsWith('--'));
const deviceId = positional[0] || 'sim-01';
const storyName = positional[1] || 'thermal';

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set — run from services/alert-rules-service');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log(`[seed] connected — ${mongoose.connection.name}`);

  if (clear) {
    const { deletedCount } = await Alert.deleteMany({ message: { $regex: /threshold|baseline|Battery at/ } });
    console.log(`[seed] removed ${deletedCount} alert(s)`);
    return;
  }

  const story = STORIES[storyName];
  if (!story) throw new Error(`unknown story "${storyName}" — choose one of: ${Object.keys(STORIES).join(', ')}`);

  const now = Date.now();
  // createdAt is set by timestamps:true, so it has to be forced per document
  // rather than passed to create() — otherwise every alert lands at "now" and
  // the burst has no shape for the model to read.
  const docs = story.map((a) => ({
    deviceId,
    type: a.type,
    severity: a.severity,
    value: a.value,
    message: a.message,
    createdAt: new Date(now - a.minutesAgo * 60 * 1000),
    updatedAt: new Date(now - a.minutesAgo * 60 * 1000),
  }));

  await Alert.insertMany(docs, { timestamps: false });
  console.log(`[seed] inserted ${docs.length} "${storyName}" alert(s) for ${deviceId}`);
  for (const d of docs) {
    console.log(`         ${d.createdAt.toISOString().slice(11, 19)}  ${d.severity.padEnd(8)} ${d.type.padEnd(18)} ${d.message}`);
  }
  console.log(`[seed] the agent polls every 60s — watch its log, then reload the dashboard`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
