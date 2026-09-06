const axios = require('axios');

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;

async function sendWebhook(alert) {
  if (!WEBHOOK_URL) {
    console.log(`[webhook] ALERT_WEBHOOK_URL not set — skipping delivery for: ${alert.message}`);
    return;
  }
  try {
    // Slack incoming-webhook body shape. Swap this if using a different provider.
    await axios.post(
      WEBHOOK_URL,
      { text: `🚨 [${alert.severity.toUpperCase()}] ${alert.deviceId}: ${alert.message}` },
      { timeout: 3000 }
    );
  } catch (err) {
    console.error('[webhook] delivery failed:', err.message);
  }
}

module.exports = { sendWebhook };
