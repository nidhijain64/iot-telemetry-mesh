// Render's Blueprint wires services together with `fromService`, which supplies
// a BARE HOSTNAME ("device-registry-service.onrender.com"). A local .env supplies
// a full URL ("http://localhost:3002"). Accept either, so the same code runs in
// both places and there is no URL left for a human to paste in by hand — which
// is where "http://localhost:3002 in production" comes from.
function serviceUrl(value, fallback) {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw) return fallback;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
}

// Same problem for the CORS allowlist: an Origin header is always a full
// origin, so a bare hostname would never match one.
function originList(value) {
  return String(value ?? '')
    .split(',')
    .map((o) => serviceUrl(o, ''))
    .filter(Boolean);
}

module.exports = { serviceUrl, originList };
