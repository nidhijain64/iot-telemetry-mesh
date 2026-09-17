// ============================================================
// The agent loop: read recent alerts, decide which are worth explaining,
// and ask an LLM what they mean together.
//
// The platform already answers "is this reading unusual?" statistically — a
// z-score does that deterministically, for free, and without a model. What it
// cannot answer is "what is going on with this device, and what should I do?",
// because that needs several alerts read in combination.
// ============================================================

const { z } = require('zod');
const Insight = require('./models/Insight');

// gpt-oss-120b rather than llama-3.3-70b: Groq only enforces a JSON schema
// (strict: true) on the gpt-oss and qwen families. This service writes model
// output straight into a database, so a guaranteed shape is worth more here
// than a slightly stronger model returning best-effort JSON.
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// A device needs at least this many alerts in the window before it is worth
// explaining. One threshold breach explains itself; a cluster does not.
const MIN_ALERTS = Number(process.env.INSIGHT_MIN_ALERTS) || 3;
const WINDOW_MS = Number(process.env.INSIGHT_WINDOW_MS) || 15 * 60 * 1000;
// Never re-explain the same device more often than this, however noisy it gets.
const PER_DEVICE_COOLDOWN_MS = Number(process.env.INSIGHT_COOLDOWN_MS) || 30 * 60 * 1000;

// Groq takes raw JSON Schema rather than a zod object, so this is the source of
// truth for the request. The zod schema below re-validates what comes back:
// strict mode constrains the shape, not the meaning, and a wrong enum value
// written into the database would be found much later than here.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One sentence under 15 words: what appears to be happening' },
    likelyCause: { type: 'string', description: 'At most two sentences on the most probable physical explanation' },
    recommendedAction: { type: 'string', description: 'One concrete thing a person should do next' },
    severity: { type: 'string', enum: ['low', 'medium', 'high'] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['headline', 'likelyCause', 'recommendedAction', 'severity', 'confidence'],
  additionalProperties: false,
};

const InsightShape = z.object({
  headline: z.string().min(1),
  likelyCause: z.string().min(1),
  recommendedAction: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  confidence: z.enum(['low', 'medium', 'high']),
});

const SYSTEM = `You triage alerts from a device telemetry platform.

Devices are phones and sensors reporting sound level, movement, battery, location
and temperature. The platform has already decided each individual alert is
unusual — fixed thresholds for temperature and battery, a rolling z-score against
the device's own recent baseline for sound, an acceleration magnitude for movement.

Your job is the part it cannot do: read a cluster of alerts together and say what
is physically going on, and what someone should do about it.

Be concrete and brief. Say "the device is being carried" rather than "anomalous
motion patterns detected". If the alerts do not support one explanation, say so
and set confidence to low — a hedged answer is more useful than a confident wrong
one. Never invent readings that are not in the evidence given to you.`;

function buildPrompt(deviceId, alerts) {
  const lines = alerts.map((a) => {
    const t = new Date(a.createdAt).toISOString().slice(11, 19);
    return `${t}  ${a.type}  ${a.severity}  value=${a.value}  ${a.message}`;
  });
  const spanMin = Math.max(
    1,
    Math.round((new Date(alerts[alerts.length - 1].createdAt) - new Date(alerts[0].createdAt)) / 60000)
  );
  return `Device: ${deviceId}
${alerts.length} alerts over ${spanMin} minute(s), oldest first:

${lines.join('\n')}

What is happening, and what should someone do?`;
}

// Groups alerts by device and drops the devices that are only mildly noisy, so a
// model call is spent only where there is something to explain.
function clustersWorthExplaining(alerts, minAlerts = MIN_ALERTS) {
  const byDevice = new Map();
  for (const a of alerts) {
    if (!byDevice.has(a.deviceId)) byDevice.set(a.deviceId, []);
    byDevice.get(a.deviceId).push(a);
  }
  const clusters = [];
  for (const [deviceId, list] of byDevice) {
    if (list.length < minAlerts) continue;
    list.sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
    clusters.push({ deviceId, alerts: list });
  }
  return clusters;
}

async function recentlyExplained(deviceId, now = Date.now()) {
  const last = await Insight.findOne({ deviceId }).sort({ createdAt: -1 }).lean();
  if (!last) return false;
  return now - new Date(last.createdAt).getTime() < PER_DEVICE_COOLDOWN_MS;
}

async function explainCluster(groq, cluster) {
  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildPrompt(cluster.deviceId, cluster.alerts) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'device_insight', strict: true, schema: RESPONSE_SCHEMA },
    },
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) {
    console.warn(`[agent] ${cluster.deviceId}: model returned no content`);
    return null;
  }

  const parsed = InsightShape.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    // Better to write nothing than a malformed insight a reader would trust.
    console.warn(`[agent] ${cluster.deviceId}: output failed validation — ${parsed.error.issues[0].message}`);
    return null;
  }

  const times = cluster.alerts.map((a) => new Date(a.createdAt));
  return Insight.create({
    deviceId: cluster.deviceId,
    alertIds: cluster.alerts.map((a) => String(a._id)),
    alertCount: cluster.alerts.length,
    windowStart: times[0],
    windowEnd: times[times.length - 1],
    ...parsed.data,
    model: MODEL,
  });
}

module.exports = {
  clustersWorthExplaining,
  recentlyExplained,
  explainCluster,
  buildPrompt,
  RESPONSE_SCHEMA,
  InsightShape,
  MODEL,
  WINDOW_MS,
  MIN_ALERTS,
};
