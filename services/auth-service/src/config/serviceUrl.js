// Accept bare Render hostnames as well as full local service URLs.
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
