const FIELDS = ['source', 'temperature', 'humidity', 'batteryLevel', 'soundLevel', 'location', 'motion', 'orientation'];
function validateReading(payload) {
  if (payload.length > 16384) throw new Error('telemetry exceeds 16 KB');
  const reading = JSON.parse(payload.toString());
  if (!reading || typeof reading !== 'object' || Array.isArray(reading)) throw new Error('telemetry must be an object');
  if (!['simulator', 'mobile-browser', 'physical-sensor'].includes(reading.source)) throw new Error('invalid telemetry source');
  const numeric = (value, min = -Infinity, max = Infinity) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
  for (const key of ['temperature', 'humidity', 'batteryLevel', 'soundLevel']) {
    if (reading[key] !== undefined && !numeric(reading[key], ['humidity', 'batteryLevel'].includes(key) ? 0 : -Infinity, ['humidity', 'batteryLevel'].includes(key) ? 100 : Infinity)) throw new Error('invalid ' + key);
  }
  for (const [key, fields] of Object.entries({location: ['lat', 'lng'], motion: ['x', 'y', 'z'], orientation: ['alpha', 'beta', 'gamma']})) {
    const value = reading[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'object' || Array.isArray(value) || fields.some(field => !(field in value) || !numeric(value[field], key === 'location' ? (field === 'lat' ? -90 : -180) : -Infinity, key === 'location' ? (field === 'lat' ? 90 : 180) : Infinity))) throw new Error('invalid ' + key);
  }
  return Object.fromEntries(FIELDS.filter(key => key in reading).map(key => [key, reading[key]]));
}
module.exports = { validateReading };
