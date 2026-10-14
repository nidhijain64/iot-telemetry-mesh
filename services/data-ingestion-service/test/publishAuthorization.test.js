const assert = require('node:assert/strict');
const axios = require('axios');
const { createBroker } = require('../src/broker');
const { validateReading } = require('../src/validateReading');
test('invalid readings never pass input validation', () => {
  for (const body of [null, [], {source:'invalid'}, {source:'simulator',batteryLevel:-1}, {source:'simulator',humidity:101}, {source:'simulator',temperature:'35'}, {source:'simulator',location:{lat:91,lng:0}}]) assert.throws(() => validateReading(Buffer.from(JSON.stringify(body))));
  assert.throws(() => validateReading(Buffer.alloc(16385)));
});
test('established device sessions are reauthorized and expired viewers receive nothing', async () => {
  const broker=await createBroker();
  const post = jest.spyOn(axios, 'post');
  try {
  const device={deviceId:'test',deviceSecret:'old',deviceType:'simulator'};
  const packet=()=>({topic:'telemetry/test',payload:Buffer.from('{"source":"simulator","temperature":22}')});
  const publish=p=>new Promise(resolve=>broker.authorizePublish(device,p,resolve));
  post.mockResolvedValue({data:{valid:true}});
  const accepted = packet();
  assert.equal(await publish(accepted),null);
  const reading = JSON.parse(accepted.payload);
  assert.match(reading.readingId, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(reading.receivedAt)));
  const next = packet();
  assert.equal(await publish(next),null);
  assert.notEqual(JSON.parse(next.payload).readingId, reading.readingId);
  post.mockResolvedValue({data:{valid:false}});assert.ok(await publish(packet()));
  post.mockRejectedValue(new Error('registry unavailable'));assert.ok(await publish(packet()));
  assert.equal(broker.authorizeForward({isViewer:true,visibleDeviceIds:new Set(['test']),tokenExpiresAt:Date.now()-1},packet()),null);
  } finally { post.mockRestore(); await new Promise(resolve => broker.close(resolve)); }
});
