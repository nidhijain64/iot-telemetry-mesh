# Running the platform on Kubernetes

These manifests run the same five services locally on minikube. They are not a
replacement for the hosted deployment — they exist to run the system under an
orchestrator and to make the scaling constraints explicit.

## Start

```bash
minikube start
minikube addons enable ingress
```

## Build the images into the cluster

minikube has its own Docker daemon, so images built on the host are invisible to
it until they are loaded:

```bash
docker compose build
for s in auth-service device-registry-service data-ingestion-service alert-rules-service api-gateway; do
  minikube image load "iot-telemetry-mesh-$s:latest"
done
```

## Create the secrets, then apply

Secrets are created from the command line so no real value is ever committed:

```bash
kubectl apply -f k8s/00-namespace.yaml

kubectl -n telemetry create secret generic telemetry-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=INTERNAL_SERVICE_KEY="$(openssl rand -hex 32)" \
  --from-literal=MONGO_URI="mongodb://mongo:27017/telemetry"

kubectl apply -f k8s/
```

## Reach it

```bash
echo "$(minikube ip) telemetry.local" | sudo tee -a /etc/hosts
curl http://telemetry.local/api/auth/../../health
```

## Watch it work

```bash
kubectl -n telemetry get pods -w
kubectl -n telemetry logs -f deploy/data-ingestion-service
kubectl -n telemetry delete pod -l app=api-gateway   # watch it come back
```

Confirm the shared state is actually shared — both ingestion replicas should
report the same device, and the debounce keys should be visible to both:

```bash
kubectl -n telemetry exec deploy/redis -- redis-cli keys 'debounce:*'
kubectl -n telemetry exec deploy/redis -- redis-cli lrange 'recent:<deviceId>' 0 -1
kubectl -n telemetry delete pod -l app=data-ingestion-service --field-selector status.phase=Running --dry-run=client
```

## Replica counts are deliberate

| service | replicas | why |
|---|---|---|
| api-gateway | 2 | genuinely stateless |
| auth-service | 2 | rate-limit counters shared via Redis, so the limit is global rather than per-replica |
| device-registry-service | 2 | the stale sweep runs in each replica, but it is one idempotent update |
| alert-rules-service | 2 | debounce cooldown and sound baseline shared via Redis |
| data-ingestion-service | 2 | broker emitter, session store and ring buffer shared via Redis |

Every service now runs more than one replica. The last two did not, for most of
this project's life, and the reason they do is the interesting part.

### What was actually in the way

Five pieces of state lived in one process's memory, and each one broke a
different way under a second replica:

| state | where | what went wrong with 2 replicas |
|---|---|---|
| Aedes subscription emitter | data-ingestion | a device on replica A was invisible to a dashboard on replica B — silently, no error |
| MQTT session/retained store | data-ingestion | sessions vanished depending on which replica a device reconnected to |
| recent-telemetry ring buffer | data-ingestion | `GET /recent/:deviceId` answered differently per replica |
| debounce cooldown | alert-rules | one duplicate alert per replica, defeating the debounce entirely |
| rolling sound baseline | alert-rules | each replica built its own "normal" from a partial slice of traffic |
| login rate-limit counters | auth | effective limit became `LOGIN_MAX × replicas` — a security regression, not a cosmetic one |

### How each one moved

- **Emitter + session store** → `mqemitter-redis` and `aedes-persistence-redis`.
  The brokers become one logical broker.
- **Ring buffer** → a Redis list, `RPUSH` + `LTRIM -SIZE -1`, which preserves
  arrival order so the API contract did not change.
- **Debounce** → `SET key NX PX`. One atomic command, so when both replicas
  evaluate the same reading simultaneously exactly one creates the key and
  exactly one alert is written. This is the only piece that needs a hard
  guarantee, and it is the only piece that gets one.
- **Sound baseline** → a Redis list with `LPUSH` + `LTRIM`, read with `LRANGE`.
  Deliberately *not* atomic: two replicas can both read the same window and both
  flag a reading, and the atomic debounce above collapses that to one alert. A
  Lua script here would buy nothing.
- **Rate-limit counters** → `rate-limit-redis`, with `passOnStoreError: true` so
  a Redis outage means unthrottled logins rather than locking every user out of
  their own account.

### Degrading, not failing

Every one of these keeps its in-process implementation and falls back to it when
`REDIS_URL` is unset or Redis is unreachable. That is what lets `npm test` and a
single-node `docker compose up` run with no Redis at all, and it means a Redis
outage costs exactness rather than availability. The fallbacks lean the same way
each time: a duplicated alert beats a missed one, unthrottled logins beat locking
users out, and a dropped live-chart entry never costs a MongoDB write.

Verify the shared paths without a cluster:

```bash
cd services/alert-rules-service && npm test   # in-process fallback
cd services/data-ingestion-service && npm test
```

### One thing to keep correct

`broker.js` persists a reading only when `client` is set, which is true only on
the replica the publisher is connected to. Every replica receives every message
over the shared Redis channel, so removing that guard would write each reading —
and run each alert check — once per replica.

### Redis is pulled, not loaded

The five service images exist only inside the cluster and use
`imagePullPolicy: Never`. `redis:7-alpine` is an ordinary public image, so it
keeps the default policy and minikube pulls it like any other.
