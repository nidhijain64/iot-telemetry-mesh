// Shake detection from raw accelerometer readings.
//
// The phone reports acceleration INCLUDING gravity, so a device sitting still
// still reads about 9.8 m/s² on whichever axis faces down. Comparing the
// magnitude of the vector (rather than any single axis) makes the check
// orientation-independent: a shake registers the same whether the phone is
// flat, upright, or in a pocket.

const SHAKE_THRESHOLD = Number(process.env.MOTION_SHAKE_THRESHOLD) || 25; // m/s²
const GRAVITY = 9.81;

function magnitude(motion) {
  const { x, y, z } = motion;
  if ([x, y, z].some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
  return Math.sqrt(x * x + y * y + z * z);
}

function checkMotionSpike(motion) {
  if (!motion || typeof motion !== 'object') return null;
  const mag = magnitude(motion);
  if (mag === null) return null;
  if (mag < SHAKE_THRESHOLD) return null;
  // Reported as the excess over gravity, so "0 g" means at rest rather than 1.
  return { magnitude: mag, gForce: Math.abs(mag - GRAVITY) / GRAVITY };
}

module.exports = { checkMotionSpike, SHAKE_THRESHOLD };
