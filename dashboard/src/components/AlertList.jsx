export default function AlertList({ alerts }) {
  if (!alerts.length) {
    return <p className="text-sm text-slate-400">No alerts yet.</p>;
  }
  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <div
          key={alert._id}
          className={`rounded-lg px-4 py-2 text-sm border ${
            alert.severity === 'critical'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}
        >
          <span className="font-medium">{alert.deviceId}</span> — {alert.message}
        </div>
      ))}
    </div>
  );
}
