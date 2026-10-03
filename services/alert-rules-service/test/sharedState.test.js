// The shared-state guarantees this service depends on once it runs more than
// one replica (k8s/23-alert-rules-service.yaml sets replicas: 2).
//
// The other detector tests cover the in-process fallback. These cover the part
// that only exists across replicas, and that no single-process test can reach:
// two independent module instances, each with its own in-memory Map, talking to
// one shared store. That is precisely the production topology.
//
// The stand-in store below implements only the commands the detectors actually
// use, which also makes it a written statement of what they rely on: SET with
// NX and PX, LPUSH, LTRIM, LRANGE, EXPIRE. If a future change needs semantics
// this fake doesn't have, that is the signal to reach for a real Redis.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.ALERT_COOLDOWN_MS = '60000';
process.env.SOUND_BASELINE_WINDOW = '5';
process.env.SOUND_Z_SCORE_THRESHOLD = '2.5';

const CONFIG = path.join(__dirname, '../src/config/redis.js');
const DEBOUNCE = path.join(__dirname, '../src/detectors/debounce.js');
const BASELINE = path.join(__dirname, '../src/detectors/soundBaseline.js');

// ---------------------------------------------------------------------------
// A minimal stand-in for Redis: enough of the command set to exercise the real
// call sites, with real NX/PX semantics because that is the whole guarantee.
// ---------------------------------------------------------------------------
function createFakeRedis() {
  const strings = new Map(); // key -> { value, expiresAt }
  const lists = new Map(); // key -> array

  function live(key) {
    const entry = strings.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      strings.delete(key);
      return null;
    }
    return entry;
  }

  const api = {
    async set(key, value, ...args) {
      // Mirrors ioredis' variadic form: set(key, value, 'PX', ms, 'NX')
      const flags = args.map((a) => String(a).toUpperCase());
      const nx = flags.includes('NX');
      const pxIndex = flags.indexOf('PX');
      const ttl = pxIndex === -1 ? null : Number(args[pxIndex + 1]);

      if (nx && live(key)) return null; // already held — caller must not fire
      strings.set(key, { value, expiresAt: ttl === null ? null : Date.now() + ttl });
      return 'OK';
    },

    async pttl(key) {
      const entry = live(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      return entry.expiresAt - Date.now();
    },

    async lrange(key, start, stop) {
      const list = lists.get(key) || [];
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      return list.slice(start < 0 ? Math.max(list.length + start, 0) : start, end);
    },

    async llen(key) {
      return (lists.get(key) || []).length;
    },

    // The detectors issue these inside multi(); exec() applies them in order.
    multi() {
      const queued = [];
      const chain = {
        lpush(key, value) {
          queued.push(() => {
            const list = lists.get(key) || [];
            list.unshift(String(value));
            lists.set(key, list);
          });
          return chain;
        },
        rpush(key, value) {
          queued.push(() => {
            const list = lists.get(key) || [];
            list.push(String(value));
            lists.set(key, list);
          });
          return chain;
        },
        ltrim(key, start, stop) {
          queued.push(() => {
            const list = lists.get(key) || [];
            const from = start < 0 ? Math.max(list.length + start, 0) : start;
            const to = stop < 0 ? list.length + stop + 1 : stop + 1;
            lists.set(key, list.slice(from, to));
          });
          return chain;
        },
        expire() {
          queued.push(() => {}); // TTL behaviour on lists isn't under test here
          return chain;
        },
        async exec() {
          for (const op of queued) op();
          return queued.map(() => [null, 'OK']);
        },
      };
      return chain;
    },
  };
  return api;
}

// Loads a fresh copy of a detector wired to `store` — one "replica". Each copy
// gets its own module scope, so its in-process Map is genuinely separate.
function loadReplica(modulePath, store) {
  for (const key of [CONFIG, DEBOUNCE, BASELINE]) delete require.cache[require.resolve(key)];
  const config = require(CONFIG);
  config.client = store;
  return require(modulePath);
}

test('debounce across replicas', async (t) => {
  await t.test('a cooldown set by one replica suppresses the other', async () => {
    const store = createFakeRedis();
    const replicaA = loadReplica(DEBOUNCE, store);
    const replicaB = loadReplica(DEBOUNCE, store);

    assert.strictEqual(await replicaA.shouldFire('dev-1', 'high-temperature'), true);
    assert.strictEqual(
      await replicaB.shouldFire('dev-1', 'high-temperature'),
      false,
      'replica B must observe replica A cooldown — this is the duplicate-alert bug'
    );
  });

  await t.test('simultaneous evaluation yields exactly one alert', async () => {
    const store = createFakeRedis();
    const replicaA = loadReplica(DEBOUNCE, store);
    const replicaB = loadReplica(DEBOUNCE, store);

    const results = await Promise.all([
      replicaA.shouldFire('dev-2', 'low-battery'),
      replicaB.shouldFire('dev-2', 'low-battery'),
    ]);

    assert.strictEqual(
      results.filter(Boolean).length,
      1,
      `exactly one replica may win the race, got ${JSON.stringify(results)}`
    );
  });

  await t.test('each alert type keeps its own cooldown', async () => {
    const store = createFakeRedis();
    const replicaA = loadReplica(DEBOUNCE, store);
    const replicaB = loadReplica(DEBOUNCE, store);

    await replicaA.shouldFire('dev-3', 'high-temperature');
    assert.strictEqual(await replicaB.shouldFire('dev-3', 'motion-shake'), true);
  });

  await t.test('the cooldown carries a TTL so nothing has to sweep it', async () => {
    const store = createFakeRedis();
    const replica = loadReplica(DEBOUNCE, store);

    await replica.shouldFire('dev-4', 'high-temperature');
    const ttl = await store.pttl('debounce:dev-4:high-temperature');
    assert.ok(ttl > 0 && ttl <= 60000, `expected a TTL within the cooldown, got ${ttl}`);
  });

  await t.test('a store failure falls back to firing rather than going silent', async () => {
    const broken = {
      async set() {
        throw new Error('connection refused');
      },
    };
    const replica = loadReplica(DEBOUNCE, broken);

    assert.strictEqual(
      await replica.shouldFire('dev-5', 'high-temperature'),
      true,
      'a duplicated alert is recoverable; a silently dropped one is not'
    );
  });
});

test('sound baseline across replicas', async (t) => {
  await t.test('replicas judge against a window both of them contributed to', async () => {
    const store = createFakeRedis();
    const replicaA = loadReplica(BASELINE, store);
    const replicaB = loadReplica(BASELINE, store);

    // Alternate replicas so neither accumulates MIN_SAMPLES on its own.
    for (let i = 0; i < 6; i++) {
      const replica = i % 2 ? replicaB : replicaA;
      await replica.checkSoundAnomaly('mic-1', 50 + (i % 3));
    }

    const anomaly = await replicaB.checkSoundAnomaly('mic-1', 95);
    assert.ok(anomaly, 'the shared window should already be warm for either replica');
    assert.ok(anomaly.zScore > 2.5, `expected a clear anomaly, got z=${anomaly && anomaly.zScore}`);
    assert.ok(anomaly.mean > 49 && anomaly.mean < 53, `baseline should reflect both, got ${anomaly.mean}`);
  });

  await t.test('the shared window is trimmed to SOUND_BASELINE_WINDOW', async () => {
    const store = createFakeRedis();
    const replicaA = loadReplica(BASELINE, store);
    const replicaB = loadReplica(BASELINE, store);

    for (let i = 0; i < 12; i++) {
      await (i % 2 ? replicaB : replicaA).checkSoundAnomaly('mic-2', 50);
    }
    assert.strictEqual(await store.llen('sound:mic-2'), 5, 'window must not grow without bound');
  });

  await t.test('a store failure degrades to a local window instead of throwing', async () => {
    const broken = {
      async lrange() {
        throw new Error('connection refused');
      },
      multi() {
        throw new Error('connection refused');
      },
    };
    const replica = loadReplica(BASELINE, broken);

    // Quiet rather than wrong: with no shared window it rebuilds locally, and
    // stays silent until it has MIN_SAMPLES of its own.
    assert.strictEqual(await replica.checkSoundAnomaly('mic-3', 50), null);
  });
});
