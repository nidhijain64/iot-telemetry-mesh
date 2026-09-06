const mongoose = require('mongoose');

async function connectDB() {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    console.log(`[db] connected — ${mongoose.connection.name}`);
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    process.exit(1);
  }
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));
}

module.exports = connectDB;
