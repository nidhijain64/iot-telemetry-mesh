// Render's Blueprint supplies a bare hostname ("api-gateway-x1.onrender.com"),
// while a local .env supplies a full URL ("http://localhost:3005"). Accept
// either and add the right scheme, so a deploy can wire these automatically
// instead of relying on someone remembering that MQTT needs wss:// and not ws://.
export function withScheme(value, scheme) {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${scheme}://${raw}`;
}
