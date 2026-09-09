import { lazy, Suspense, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// One metric at a time on a shared axis. Temperature (~15-40°C), sound
// (~30-90dB) and battery (0-100%) don't share a scale, so overlaying them
// would make each one unreadable to save a single click.
const GRAVITY = 9.81;

const METRICS = [
  { key: 'soundLevel', label: 'Sound', unit: 'dB', color: '#7c3aed' },
  // Derived rather than stored: the accelerometer reports three axes, and the
  // magnitude of that vector is the part that means something over time. Shown
  // as departure from gravity so a phone lying still sits at 0 instead of 9.8.
  {
    key: 'motion',
    label: 'Motion',
    unit: ' m/s²',
    color: '#ea580c',
    derive: (r) => {
      const m = r.motion;
      if (!m || typeof m.x !== 'number') return null;
      return Math.round((Math.sqrt(m.x ** 2 + m.y ** 2 + m.z ** 2) - GRAVITY) * 10) / 10;
    },
  },
  { key: 'batteryLevel', label: 'Battery', unit: '%', color: '#16a34a' },
  { key: 'temperature', label: 'Temperature', unit: '°C', color: '#dc2626' },
  { key: 'humidity', label: 'Humidity', unit: '%', color: '#0891b2' },
];

// Leaflet and its CSS only load once someone opens the map.
const DeviceMap = lazy(() => import('./DeviceMap'));

// Location is deliberately not in METRICS: latitude against time is a
// meaningless line, and a scatter of raw coordinates is not much better —
// nobody reads "81.7737" as a place. It gets a real map instead.
const TRACK = { key: '__track', label: 'Map', color: '#0891b2' };

function readValue(metric, reading) {
  const v = metric.derive ? metric.derive(reading) : reading[metric.key];
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

function trackPoints(readings) {
  return readings
    .filter((r) => r.location && typeof r.location.lat === 'number' && typeof r.location.lng === 'number')
    .map((r) => ({ lat: r.location.lat, lng: r.location.lng, time: formatTime(r.receivedAt) }));
}

function formatTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

function MetricButtons({ available, active, onMetricChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {available.map((m) => (
        <button
          key={m.key}
          onClick={() => onMetricChange(m.key)}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            m.key === active.key
              ? 'bg-slate-800 text-white border-slate-800'
              : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export default function TelemetryChart({ readings, metric, onMetricChange }) {
  // Only offer metrics this device actually reports — a phone sends sound and
  // battery but no temperature, a simulator the other way around.
  const track = useMemo(() => trackPoints(readings), [readings]);

  const available = useMemo(() => {
    const found = METRICS.filter((m) => readings.some((r) => readValue(m, r) !== null));
    return track.length > 1 ? [...found, TRACK] : found;
  }, [readings, track]);

  const active = available.find((m) => m.key === metric) || available[0];

  const data = useMemo(() => {
    if (!active || active.key === TRACK.key) return [];
    return readings
      .map((r) => ({ time: formatTime(r.receivedAt), value: readValue(active, r) }))
      .filter((d) => d.value !== null);
  }, [readings, active]);

  if (active && active.key === TRACK.key) {
    return (
      <div className="space-y-3">
        <MetricButtons available={available} active={active} onMetricChange={onMetricChange} />
        <Suspense fallback={<p className="text-sm text-slate-400">Loading map…</p>}>
          <DeviceMap points={track} />
        </Suspense>
        <p className="text-xs text-slate-400">
          {track.length} GPS fixes, oldest to newest. The filled marker is the most recent.
        </p>
      </div>
    );
  }

  if (!active || data.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No history yet for this device — readings appear here as they arrive.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <MetricButtons available={available} active={active} onMetricChange={onMetricChange} />

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={32} />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b' }}
              domain={['auto', 'auto']}
              unit={active.unit}
              width={56}
            />
            <Tooltip
              formatter={(value) => [`${value}${active.unit}`, active.label]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={active.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
