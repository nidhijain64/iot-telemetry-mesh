// A phone at rest still reads ~9.8 m/s² because the accelerometer includes
// gravity, so "moving" is judged by how far the magnitude departs from that,
// not by whether it is above zero.
const GRAVITY = 9.81;

function motionState(motion) {
  if (!motion || typeof motion.x !== 'number') return null;
  const mag = Math.sqrt(motion.x ** 2 + motion.y ** 2 + motion.z ** 2);
  const delta = Math.abs(mag - GRAVITY);
  if (mag >= 25) return { label: 'shaken', mag, cls: 'bg-red-100 text-red-700' };
  if (delta > 1.5) return { label: 'in motion', mag, cls: 'bg-amber-100 text-amber-700' };
  return { label: 'at rest', mag, cls: 'bg-slate-100 text-slate-600' };
}

export default function DeviceCard({ device, reading, selected, onSelect }) {
  const isSim = reading?.source === 'simulator';
  const isReal = reading?.source === 'mobile-browser';
  const motion = motionState(reading?.motion);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full text-left bg-white rounded-xl shadow-sm border p-4 space-y-2 transition-colors ${
        selected ? 'border-slate-800 ring-1 ring-slate-800' : 'border-slate-200 hover:border-slate-400'
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">{device.label}</h3>
        {isSim && (
          <span className="text-xs font-medium bg-green-100 text-green-700 px-2 py-1 rounded-full">
            🤖 SIM
          </span>
        )}
        {isReal && (
          <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2 py-1 rounded-full border border-purple-300">
            📱 REAL DEVICE
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500">{device.deviceId}</p>
      <div className="flex items-center gap-2 text-sm">
        <span className={`inline-block w-2 h-2 rounded-full ${device.isOnline ? 'bg-green-500' : 'bg-slate-300'}`} />
        <span className="text-slate-600">{device.isOnline ? 'online' : 'offline'}</span>
        <span className="text-slate-400">· {device.status}</span>
      </div>

      {reading ? (
        <div className="grid grid-cols-2 gap-2 pt-2 text-sm">
          {typeof reading.temperature === 'number' && (
            <div><span className="text-slate-400">Temp</span><div className="font-medium">{reading.temperature}°C</div></div>
          )}
          {typeof reading.batteryLevel === 'number' && (
            <div><span className="text-slate-400">Battery</span><div className="font-medium">{reading.batteryLevel}%</div></div>
          )}
          {typeof reading.soundLevel === 'number' && (
            <div><span className="text-slate-400">Sound</span><div className="font-medium">{reading.soundLevel} dB</div></div>
          )}
          {motion && (
            <div>
              <span className="text-slate-400">Motion</span>
              <div className="font-medium flex items-center gap-1.5">
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${motion.cls}`}>{motion.label}</span>
                <span className="text-slate-500 text-xs">{motion.mag.toFixed(1)} m/s²</span>
              </div>
            </div>
          )}
          {reading.orientation && typeof reading.orientation.beta === 'number' && (
            <div><span className="text-slate-400">Tilt</span><div className="font-medium">{Math.round(reading.orientation.beta)}° / {Math.round(reading.orientation.gamma)}°</div></div>
          )}
          {reading.location && (
            <div><span className="text-slate-400">Location</span><div className="font-medium">{reading.location.lat?.toFixed(3)}, {reading.location.lng?.toFixed(3)}</div></div>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-400 pt-2">No live data yet</p>
      )}
    </button>
  );
}
