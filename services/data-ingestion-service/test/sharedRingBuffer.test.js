// The ring buffer's shared path, which only matters once this service runs more
// than one replica (k8s/22-data-ingestion-service.yaml sets replicas: 2).
//
// ringBuffer.test.js covers the in-process fallback. This covers what that test
// structurally cannot: GET /recent/:deviceId must return the same history no
// matter which replica the Ingress happened to route the request to. Before the
// buffer was shared, two replicas answered the same request differently and
// nothing anywhere reported a problem.
//
// The stand-in store implements only RPUSH, LTRIM, EXPIRE and LRANGE — the
// commands the buffer actually issues — so it doubles as a statement of what
// the implementation depends on. RPUSH + LTRIM from the tail is what preserves
// arrival order, which is the property the API contract rests on.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.RING_BUFFER_SIZE = '3';

const CONFIG = path.join(__dirname, '../src/config/redis.js');
const RING_BUFFER = path.join(__dirname, '../src/ringBuffer.js');

function createFakeRedis() {
  const lists = new Map();

  return {
    async lrange(key, start, stop) {
      const list = lists.get(key) || [];
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      return list.slice(start < 0 ? Math.max(list.length + start, 0) : start, end);
    },
    async llen(key) {
      return (lists.get(key) || []).length;
    },
    multi() {
      const queued = [];
      const chain = {
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
          queued.push(() => {});
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
}

// One "replica": a fresh module scope, so its fallback Map is genuinely its own.
function loadReplica(store) {
  for (const key of [CONFIG, RING_BUFFER]) delete require.cache[require.resolve(key)];
  const config = require(CONFIG);
  config.client = store;
  return require(RING_BUFFER);
}

test('ring buffer across replicas', async (t) => {
  await t.test('either replica returns the full arrival-ordered history', async () => {
    const store = createFakeRedis();
    const replicaA = loadReplica(store);
    const replicaB = loadReplica(store);

    await replicaA.push('dev-x', { n: 1 });
    await replicaB.push('dev-x', { n: 2 });
    await replicaA.push('dev-x', { n: 3 });

    const expected = [{ n: 1 }, { n: 2 }, { n: 3 }];
    assert.deepStrictEqual(await replicaA.getRecent('dev-x'), expected);
    assert.deepStrictEqual(
      await replicaB.getRecent('dev-x'),
      expected,
      'both replicas must answer /recent identically — that was the original bug'
    );
  });

  await t.test('the oldest reading is dropped once the buffer is full', async () => {
    const store = createFakeRedis();
    const replicaA = loadReplica(store);
    const replicaB = loadReplica(store);

    for (const n of [1, 2, 3, 4, 5]) {
      await (n % 2 ? replicaA : replicaB).push('dev-y', { n });
    }
    assert.deepStrictEqual(await replicaB.getRecent('dev-y'), [{ n: 3 }, { n: 4 }, { n: 5 }]);
  });

  await t.test('a device nobody has published for returns an empty list', async () => {
    const replica = loadReplica(createFakeRedis());
    assert.deepStrictEqual(await replica.getRecent('never-seen'), []);
  });

  await t.test('a corrupt entry is skipped rather than failing the response', async () => {
    const store = createFakeRedis();
    const replica = loadReplica(store);

    await replica.push('dev-z', { n: 1 });
    await store.multi().rpush('recent:dev-z', 'not-json').exec();
    await replica.push('dev-z', { n: 2 });

    assert.deepStrictEqual(
      await replica.getRecent('dev-z'),
      [{ n: 1 }, { n: 2 }],
      'one bad entry must not take down the whole live view'
    );
  });

  await t.test('a store failure never costs a reading', async () => {
    const broken = {
      multi() {
        throw new Error('connection refused');
      },
      async lrange() {
        throw new Error('connection refused');
      },
    };
    const replica = loadReplica(broken);

    // push() must resolve, not reject: broker.js awaits it on the ingest path,
    // and the MongoDB write that follows is the one that must not be skipped.
    await replica.push('dev-w', { n: 1 });
    assert.deepStrictEqual(
      await replica.getRecent('dev-w'),
      [{ n: 1 }],
      'it should have fallen back to the local buffer'
    );
  });
});
