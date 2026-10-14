// Accept Render hostnames and local URLs, using the appropriate HTTP or WebSocket scheme.
export function withScheme(value, scheme) {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${scheme}://${raw}`;
}
