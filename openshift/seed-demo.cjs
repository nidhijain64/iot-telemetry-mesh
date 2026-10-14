// Run inside the auth-service container; credentials match the intentional public demo.
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./src/models/User');
(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const username = 'admin1';
  const existing = await User.findOne({ username });
  if (existing) {
    if (existing.role !== 'admin') throw new Error('Existing demo username is not an admin; review it before changing its permissions.');
    console.log('Demo administrator already exists.');
  } else {
    await User.create({ username, role: 'admin', passwordHash: await bcrypt.hash('FleetAdmin2026', 12) });
    console.log('Created public demo administrator.');
  }
})().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
