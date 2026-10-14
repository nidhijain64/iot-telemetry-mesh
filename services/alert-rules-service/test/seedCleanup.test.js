const mongoose = require('mongoose');
const Alert = require('../src/models/Alert');
test('demo cleanup preserves real threshold and baseline alerts', async () => {
  const originalArgs = process.argv;
  const originalUri = process.env.MONGO_URI;
  process.argv = ['node', 'seed-demo-alerts.js', '--clear'];
  process.env.MONGO_URI = 'mongodb://unused/test';
  jest.spyOn(mongoose, 'connect').mockResolvedValue();
  const docs = [
    { message: 'Temperature 40°C exceeds 35°C threshold' },
    { message: 'Sound above baseline' },
    { seedTag: 'demo-alerts', message: 'demo' },
  ];
  jest.spyOn(Alert, 'deleteMany').mockImplementation(async filter => {
    for (let i = docs.length - 1; i >= 0; i--) {
      if (Object.entries(filter).every(([key, value]) => docs[i][key] === value)) docs.splice(i, 1);
    }
    return { deletedCount: 1 };
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await require('../scripts/seed-demo-alerts').main();
    expect(docs.map(d => d.message)).toEqual(['Temperature 40°C exceeds 35°C threshold', 'Sound above baseline']);
  } finally {
    process.argv = originalArgs;
    if (originalUri === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = originalUri;
  }
});
