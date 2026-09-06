# Deploying to Render

`render.yaml` in the repo root defines all six services. This document covers
the values it deliberately leaves blank, and the two things that will bite you
if nobody warns you first.

## Read this before you start

**Free instances sleep.** Render spins a free service down after ~15 minutes
idle, and the next request wakes it — roughly 30–60 seconds. There are five
services here, so a cold visitor can wait a while, and requests that fan out
across services can wake several at once. Open the dashboard yourself a minute
before showing anyone.

**The simulator is not deployed, on purpose.** It has to run continuously to
produce data, which is exactly what a sleeping free instance cannot do. Run it
from your laptop against the deployed backend instead (last section) — it also
makes a better demo, because you can point at your own terminal and show the
devices provisioning themselves live.

---

## 1. MongoDB Atlas

Create a free M0 cluster and a database user.

Under **Network Access**, add `0.0.0.0/0`. Render's free plan gives no static
outbound IP, so there is nothing narrower to allowlist. That makes the database
reachable from anywhere, so the password is the only thing protecting it — use a
long generated one, and never reuse it.

Your connection string looks like:

```
mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/iot
```

One cluster is fine for all four services. Give each its own database name by
changing the path: `/iot_auth`, `/iot_devices`, `/iot_telemetry`, `/iot_alerts`.

## 2. Generate the two shared secrets

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"; echo "INTERNAL_SERVICE_KEY=$(openssl rand -hex 32)"
```

Keep both somewhere you can paste from. `JWT_SECRET` must be **byte-identical**
across all four services — each verifies tokens locally instead of calling
auth-service, so a mismatch shows up as `Invalid token` on a perfectly valid
login. `INTERNAL_SERVICE_KEY` must match across device-registry,
data-ingestion, and alert-rules.

## 3. Create the Blueprint

In Render: **New +** → **Blueprint** → pick this repo. It reads `render.yaml`
and prompts for every `sync: false` value. Fill in `MONGO_URI`, `JWT_SECRET`,
`INTERNAL_SERVICE_KEY`, and leave the URL fields blank for now — they refer to
services that don't exist yet.

The first deploy will partially fail. That is expected.

## 4. Fill in the URLs, then redeploy

Once the services exist, Render shows each one's URL (typically
`https://<service-name>.onrender.com`). Set these under each service's
**Environment** tab:

| Service | Variable | Value |
|---|---|---|
| api-gateway | `AUTH_URL` | auth-service URL |
| api-gateway | `DEVICE_REGISTRY_URL` | device-registry-service URL |
| api-gateway | `INGESTION_URL` | data-ingestion-service URL |
| api-gateway | `ALERT_URL` | alert-rules-service URL |
| data-ingestion-service | `DEVICE_REGISTRY_URL` | device-registry-service URL |
| data-ingestion-service | `ALERT_SERVICE_URL` | alert-rules-service URL |
| alert-rules-service | `DEVICE_REGISTRY_URL` | device-registry-service URL |
| *all five services* | `CORS_ORIGIN` | the **iot-dashboard** URL |
| iot-dashboard | `VITE_API_URL` | the **api-gateway** URL |
| iot-dashboard | `VITE_MQTT_WS_URL` | data-ingestion URL with `wss://` |

Include the scheme and no trailing slash: `https://api-gateway.onrender.com`.

`VITE_MQTT_WS_URL` is the one people get wrong. It points at
**data-ingestion-service, not the gateway** — the gateway proxies HTTP only, and
a WebSocket upgrade doesn't survive it. And it must be `wss://`, not `ws://`:
the page is served over HTTPS, and browsers refuse an insecure socket from a
secure page. So:

```
wss://data-ingestion-service.onrender.com
```

Then redeploy everything. The dashboard in particular **must** be rebuilt after
changing a `VITE_*` value — Vite inlines those at build time, so a restart alone
keeps the old values baked in.

## 5. Check it

```bash
curl https://api-gateway.onrender.com/health
```

Expect `{"status":"ok","service":"api-gateway"}`. Allow for a cold start on the
first request.

Then create an account:

```bash
curl -X POST https://api-gateway.onrender.com/api/auth/register -H 'Content-Type: application/json' -d '{"username":"demo","password":"a-strong-password"}'
```

Log into the dashboard with it. An empty fleet and no alerts is correct — you
have no devices yet.

## 6. Point the simulator at it

In `simulator/.env`:

```
AUTH_URL=https://api-gateway.onrender.com
DEVICE_REGISTRY_URL=https://api-gateway.onrender.com
MQTT_WS_URL=wss://data-ingestion-service.onrender.com
SIM_USERNAME=demo
SIM_PASSWORD=a-strong-password
FLEET_SIZE=3
```

```bash
cd simulator && npm start
```

It logs in, registers three devices, issues their credentials, and starts
publishing. Refresh the dashboard and the fleet appears — cards go online,
telemetry streams in, and alerts start firing once a simulated sensor crosses a
threshold.

Streaming from a real phone works too: open `/mobile-node` on the deployed
dashboard. It is already HTTPS, which is what the microphone and motion sensors
require, so no certificate setup is needed.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Invalid token` on a correct password | `JWT_SECRET` differs between services |
| Dashboard loads, every request fails | `CORS_ORIGIN` doesn't match the dashboard URL exactly |
| Cards render but never show live values | `VITE_MQTT_WS_URL` wrong, or `ws://` instead of `wss://` |
| Devices connect but no alerts | `INTERNAL_SERVICE_KEY` differs between ingestion and alert-rules |
| Changed a `VITE_*` var, nothing happened | Rebuild the dashboard — a restart won't do it |
| First request hangs ~50s | Free instance waking from sleep |
