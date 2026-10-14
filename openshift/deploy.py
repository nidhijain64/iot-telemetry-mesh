#!/usr/bin/env python3
"""Deploy a separate demo to an explicitly selected OpenShift project."""
import argparse
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SERVICES = {'auth-service': 3001, 'device-registry-service': 3002,
            'data-ingestion-service': 3003, 'alert-rules-service': 3004,
            'api-gateway': 3005, 'insight-agent': 3006, 'dashboard': 8080}
parser = argparse.ArgumentParser()
parser.add_argument('--project', required=True)
parser.add_argument('--only', nargs='+', choices=list(SERVICES), help='Rebuild only these services')
args = parser.parse_args()
PROJECT = args.project

def oc(*cmd, data=None, capture=False):
    result = subprocess.run(['oc', '-n', PROJECT, *cmd], input=data, text=True,
                            stdout=subprocess.PIPE if capture else None, check=True)
    return result.stdout.strip() if capture else None

def resource(kind, name, spec=None, api='v1', **extra):
    obj = {'apiVersion': api, 'kind': kind, 'metadata': {'name': name, 'labels': {'app.kubernetes.io/part-of': 'telemetry'}}}
    if spec is not None: obj['spec'] = spec
    obj.update(extra)
    return obj

def apply(obj):
    oc('apply', '--server-side', '--field-manager=telemetry-deploy', '-f', '-', data=json.dumps(obj))

def service(name, port):
    apply(resource('Service', name, {'selector': {'app': name}, 'ports': [{'name': 'http', 'port': port, 'targetPort': port}]}))

def deploy(name, image, port, env=None, command=None, volume=False):
    container = {'name': name, 'image': image, 'imagePullPolicy': 'Always',
                 'ports': [{'containerPort': port}],
                 'resources': {'requests': {'cpu': '50m', 'memory': '128Mi'}, 'limits': {'cpu': '500m', 'memory': '512Mi'}},
                 'securityContext': {'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}, 'runAsNonRoot': True},
                 'readinessProbe': {'tcpSocket': {'port': port}, 'initialDelaySeconds': 5, 'periodSeconds': 5}}
    if name in SERVICES:
        container['readinessProbe'] = {'httpGet': {'path': '/' if name == 'dashboard' else '/health', 'port': port}, 'initialDelaySeconds': 5, 'periodSeconds': 5}
        if name != 'dashboard':
            container['envFrom'] = [{'configMapRef': {'name': 'telemetry-config'}}, {'secretRef': {'name': 'telemetry-secrets'}}]
            env = {'PORT': str(port), **(env or {})}
    if env: container['env'] = [{'name': k, 'value': v} for k, v in env.items()]
    if command: container['command'] = command
    pod = {'automountServiceAccountToken': False, 'containers': [container]}
    if volume:
        pod['volumes'] = [{'name': 'data', 'persistentVolumeClaim': {'claimName': 'mongo-data'}}]
        container['volumeMounts'] = [{'name': 'data', 'mountPath': '/data/db'}]
    spec = {'replicas': 1, 'selector': {'matchLabels': {'app': name}}, 'template': {'metadata': {'labels': {'app': name}}, 'spec': pod}}
    if volume: spec['strategy'] = {'type': 'Recreate'}
    apply(resource('Deployment', name, spec, api='apps/v1'))

# Read only the requested local key, never upload .env or its other values.
key = os.environ.get('GROQ_API_KEY', '')
if not key:
    env_path = ROOT / 'services/insight-agent/.env'
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith('GROQ_API_KEY='):
                key = line.split('=', 1)[1].strip().strip('\"\'')
if not key: raise SystemExit('Set GROQ_API_KEY locally before deploying.')
oc('get', 'project', PROJECT, capture=True)
print(f'Preparing separate telemetry demo in {PROJECT}', flush=True)
existing = oc('get', 'secret', 'telemetry-secrets', '--ignore-not-found', '-o', 'name', capture=True)
if existing:
    oc('patch', 'secret', 'telemetry-secrets', '--type=merge', '--patch-file=/dev/stdin', data=json.dumps({'stringData': {'GROQ_API_KEY': key}}))
else:
    apply(resource('Secret', 'telemetry-secrets', type='Opaque', stringData={
        'JWT_SECRET': secrets.token_hex(32), 'INTERNAL_SERVICE_KEY': secrets.token_hex(32),
        'GROQ_API_KEY': key, 'MONGO_URI': 'mongodb://mongo:27017/telemetry'}))

hosts = {}
for route_name, target in [('telemetry-dashboard', 'dashboard'), ('telemetry-api', 'api-gateway'), ('telemetry-mqtt', 'data-ingestion-service')]:
    service(target, SERVICES[target])
    obj = resource('Route', route_name, {'to': {'kind': 'Service', 'name': target}, 'port': {'targetPort': 'http'}, 'tls': {'termination': 'edge', 'insecureEdgeTerminationPolicy': 'Redirect'}}, api='route.openshift.io/v1')
    obj['metadata']['annotations'] = {'haproxy.router.openshift.io/timeout': '1h'}
    apply(obj)
    hosts[target] = oc('get', 'route', route_name, '-o', 'jsonpath={.spec.host}', capture=True)
config = {'NODE_ENV': 'production', 'REDIS_URL': 'redis://redis:6379', 'SSL_KEY_PATH': '', 'SSL_CERT_PATH': '',
          'CORS_ORIGIN': 'https://' + hosts['dashboard'], 'JWT_EXPIRY': '1h', 'ALERT_WEBHOOK_URL': '', 'UPSTREAM_TIMEOUT_MS': '10000'}
for k, s in {'AUTH_URL': 'auth-service', 'DEVICE_REGISTRY_URL': 'device-registry-service', 'INGESTION_URL': 'data-ingestion-service', 'ALERT_URL': 'alert-rules-service', 'ALERT_SERVICE_URL': 'alert-rules-service', 'INSIGHT_URL': 'insight-agent'}.items():
    config[k] = f'http://{s}:{SERVICES[s]}'
apply(resource('ConfigMap', 'telemetry-config', data=config))
apply(resource('PersistentVolumeClaim', 'mongo-data', {'accessModes': ['ReadWriteOnce'], 'resources': {'requests': {'storage': '1Gi'}}}))
service('mongo', 27017)
deploy('mongo', 'docker.io/library/mongo:7', 27017, env={'HOME': '/tmp'}, command=['mongod', '--bind_ip_all', '--dbpath', '/data/db'], volume=True)
service('redis', 6379)
deploy('redis', 'docker.io/library/redis:7-alpine', 6379, command=['redis-server', '--save', '', '--maxmemory', '128mb', '--maxmemory-policy', 'allkeys-lru'])

for name, port in SERVICES.items():
    if args.only and name not in args.only: continue
    print(f'Building {name} from source (no .env, keys, or node_modules uploaded)', flush=True)
    apply(resource('ImageStream', name, {}, api='image.openshift.io/v1'))
    docker_strategy = {}
    if name == 'dashboard':
        docker_strategy['buildArgs'] = [{'name': 'VITE_API_URL', 'value': 'https://' + hosts['api-gateway']}, {'name': 'VITE_MQTT_WS_URL', 'value': 'wss://' + hosts['data-ingestion-service']}]
    apply(resource('BuildConfig', name, {'runPolicy': 'Serial', 'source': {'type': 'Binary'},
        'strategy': {'type': 'Docker', 'dockerStrategy': docker_strategy},
        'output': {'to': {'kind': 'ImageStreamTag', 'name': name + ':latest'}},
        'resources': {'requests': {'cpu': '100m', 'memory': '512Mi'}, 'limits': {'cpu': '1', 'memory': '2Gi'}},
        'successfulBuildsHistoryLimit': 2, 'failedBuildsHistoryLimit': 2}, api='build.openshift.io/v1'))
    with tempfile.TemporaryDirectory(prefix='telemetry-build-') as tmp:
        archive = Path(tmp) / 'source.tar.gz'
        base = ROOT / ('dashboard' if name == 'dashboard' else 'services/' + name)
        with tarfile.open(archive, 'w:gz') as tar:
            for item in ['package.json', 'package-lock.json', 'src']:
                tar.add(base / item, arcname=item)
            if name == 'dashboard':
                for item in ['index.html', 'vite.config.js', 'public']: tar.add(base / item, arcname=item)
                tar.add(ROOT / 'openshift/dashboard.Dockerfile', arcname='Dockerfile')
                tar.add(ROOT / 'openshift/nginx.conf', arcname='nginx.conf')
            else:
                # Numeric image user supports OpenShift's arbitrary UID policy.
                dockerfile = (base / 'Dockerfile').read_text().replace('node:20-alpine', 'node:24-alpine').replace('USER node', 'USER 1000')
                encoded = dockerfile.encode()
                info = tarfile.TarInfo('Dockerfile'); info.size = len(encoded)
                tar.addfile(info, io.BytesIO(encoded))
        oc('start-build', name, '--from-archive=' + str(archive), '--wait')
    image = oc('get', 'imagestreamtag', name + ':latest', '-o', 'jsonpath={.image.dockerImageReference}', capture=True)
    service(name, port)
    deploy(name, image, port)

for name in ['mongo', 'redis', *SERVICES]:
    oc('rollout', 'status', 'deployment/' + name, '--timeout=180s')
print('Dashboard: https://' + hosts['dashboard'], flush=True)
print('API: https://' + hosts['api-gateway'], flush=True)
