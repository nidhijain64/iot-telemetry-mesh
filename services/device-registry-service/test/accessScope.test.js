const express = require('express');
const jwt = require('jsonwebtoken');
const Device = require('../src/models/Device');
process.env.JWT_SECRET = 'scope-regression-test';
const routes = require('../src/routes/deviceRoutes');
const devices = [
  { deviceId: 'alice-device', registeredBy: 'alice' },
  { deviceId: 'bob-device', registeredBy: 'bob' },
];
let server;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api/devices', routes);
  server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
});
afterAll(() => new Promise(resolve => server.close(resolve)));
async function fleet(role, sub) {
  jest.spyOn(Device, 'find').mockImplementation(filter => ({ sort: async () => devices.filter(d => !filter.registeredBy || d.registeredBy === filter.registeredBy) }));
  const token = jwt.sign({ sub, role }, process.env.JWT_SECRET);
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/devices`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return res.json();
}
test('admin sees every operator’s devices', async () => {
  expect((await fleet('admin', 'admin')).map(d => d.deviceId)).toEqual(['alice-device', 'bob-device']);
});
test('operator sees only their own devices', async () => {
  expect((await fleet('operator', 'alice')).map(d => d.deviceId)).toEqual(['alice-device']);
});
