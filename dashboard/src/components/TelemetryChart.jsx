import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// One metric at a time on a shared axis. Temperature (~15-40°C), sound
// (~30-90dB) and battery (0-100%) don't share a scale, so overlaying them
// would make each one unreadable to save a single click.
const METRICS = [
  { key: 'temperature', label: 'Temperature', unit: '°C', color: '#dc2626' },
  { key: 'batteryLevel', label: 'Battery', unit: '%', color: '#16a34a' },
  { key: 'soundLevel', label: 'Sound', unit: 'dB', color: '#7c3aed' },
  { key: 'humidity', label: 'Humidity', unit: '%', color: '#0891b2' },
];

function formatTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

export default function TelemetryChart({ readings, metric, onMetricChange }) {
  // Only offer metrics this device actually reports — a phone sends sound and
  // battery but no temperature, a simulator the other way around.
  const available = useMemo(
    () => METRICS.filter((m) => readings.some((r) => typeof r[m.key] === 'number')),
    [readings]
  );

  const active = available.find((m) => m.key === metric) || available[0];

  const data = useMemo(() => {
    if (!active) return [];
    return readings
      .filter((r) => typeof r[active.key] === 'number')
      .map((r) => ({ time: formatTime(r.receivedAt), value: r[active.key] }));
  }, [readings, active]);

  if (!active || data.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No history yet for this device — readings appear here as they arrive.
      </p>
    );
  }

  return (
    <div className="space-y-3">
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
