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

## Replica counts are deliberate

| service | replicas | why |
|---|---|---|
| api-gateway | 2 | genuinely stateless |
| auth-service | 2 | stateless apart from in-memory rate-limit counters, which become per-replica |
| device-registry-service | 2 | the stale sweep runs in each replica, but it is one idempotent update |
| alert-rules-service | **1** | debounce cooldown and the sound baseline are per-process; more replicas would duplicate alerts |
| data-ingestion-service | **1** | the MQTT broker holds per-connection state; a second replica would leave devices invisible to dashboards attached to the other one |

The last two are the point. Scaling them needs shared state — a Redis or
MongoDB-backed emitter for the broker, and a shared store for the debounce —
not a higher replica count.
