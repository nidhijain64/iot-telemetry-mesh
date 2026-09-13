import { withScheme } from './url';

const API_URL = withScheme(import.meta.env.VITE_API_URL, 'https');

let started = false;

// Free instances sleep, and the gateway cannot wake its own upstreams — a
// request from one Render service to a sleeping one is rejected before it
// arrives, so nothing spins up and every proxied call 502s in ~40ms no matter
// how many times it is retried. A request from a browser does wake them.
//
// So the page pings each service directly on load. no-cors because the response
// is irrelevant: the request reaching Render is what starts the instance, and
// no-cors sidesteps needing CORS configured on every service just to warm it.
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
