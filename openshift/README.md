# OpenShift Sandbox deployment

This deployment runs separately from Render and local Minikube. It creates a new
MongoDB database with a persistent volume, Redis, six backend services and the
React dashboard in your selected OpenShift project. It does not migrate existing
users or data. Public Routes use HTTPS and MQTT over WSS.

After installing `oc` and logging into your Sandbox, run from the repository root:

```bash
python3 openshift/deploy.py --project YOUR_SANDBOX_PROJECT
```

The script reads `GROQ_API_KEY` from the shell or the local insight-agent `.env`,
then sends that key as an OpenShift Secret. JWT and internal-service keys are
created on the first deployment and preserved on reruns. Build archives contain
only explicitly selected source/build files; `.env` files and local credentials
are not uploaded as build inputs. Container images are built in OpenShift and
stored in its internal registry. Each deployment references the built image digest.

All services run one replica to keep the Sandbox demo small. Increase replicas
only after checking project quotas and behavior; the insight agent stays at one.
The existing public demo login is intentionally retained in the frontend, but the
new database needs its demo administrator provisioned before that button works.
New self-registered accounts are operators. Do not change registration to grant admin.

Inspect resources:

```bash
oc get pods,builds,routes
oc logs deployment/api-gateway --tail=30
```

Keep Render available until the OpenShift demo has been verified. The Developer
Sandbox is temporary; a working Sandbox URL is not a permanent hosting arrangement.

To initialize the intentional public demo admin in the new database:

```bash
oc -n YOUR_SANDBOX_PROJECT exec -i deployment/auth-service -- node < openshift/seed-demo.cjs
```

For subsequent updates, rebuild only changed services with
`--only dashboard api-gateway` (or other service names). The script preserves
existing database contents and authentication secrets.

## Verified Sandbox instance

Project: `nidhijain64-dev`

Dashboard: https://telemetry-dashboard-nidhijain64-dev.apps.rm3.7wse.p1.openshiftapps.com

API: https://telemetry-api-nidhijain64-dev.apps.rm3.7wse.p1.openshiftapps.com

MQTT: wss://telemetry-mqtt-nidhijain64-dev.apps.rm3.7wse.p1.openshiftapps.com

Verified public demo login, administrator access to both demo devices, operator
isolation, WSS publishing/subscription, persisted reading IDs, generated alerts,
and the browser history chart. Test devices stop publishing when the smoke test
ends and will then show offline. Real phone permissions and a live Groq model
response are not covered by this smoke check. Render remains unchanged.

```bash
node openshift/smoke.cjs \
  https://telemetry-api-nidhijain64-dev.apps.rm3.7wse.p1.openshiftapps.com \
  wss://telemetry-mqtt-nidhijain64-dev.apps.rm3.7wse.p1.openshiftapps.com
```

This check creates a synthetic operator account/device and sample readings; it
leaves the resulting data available in the public demo administrator's dashboard.

## Historical data copy — 12 October 2026

Copied the old configured MongoDB data into the separate Sandbox database without
modifying the source: 8 users matched/imported (one existing demo administrator
retained), 8 devices, 4,235 readings, 108 alerts, and 9 insights. Existing Sandbox
sample records were preserved. Device ownership was remapped for the existing
administrator; one historical device with a missing user retains its original
owner reference and remains visible to admins. Original IDs and timestamps were
preserved. Collection counts were verified after the merge.

This was a one-time copy, not continuous synchronization with Render. The dashboard
history chart defaults to the latest 200 readings per device; older imported
records remain stored. Devices need not be online to view saved history.
