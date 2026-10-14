import { withScheme } from './url';

const API_URL = withScheme(import.meta.env.VITE_API_URL, 'https');

let started = false;

// Ping Render services from the browser to wake idle instances.
// Use no-cors because only the request is needed, not the response.
export function warmUpServices() {
  if (started || !API_URL) return;
  started = true;

  fetch(`${API_URL}/upstreams`)
    .then((r) => r.json())
    .then(({ services }) => {
      (services || []).forEach((base) => {
        fetch(`${base}/health`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
      });
    })
    .catch(() => {
      // Gateway itself asleep — hitting it above has already started it waking.
    });
}
