export default function DeviceCard({ device, reading, selected, onSelect }) {
  const isSim = reading?.source === 'simulator';
  const isReal = reading?.source === 'mobile-browser';

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
