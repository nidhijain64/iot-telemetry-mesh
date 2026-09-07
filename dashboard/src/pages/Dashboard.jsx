import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mqtt from 'mqtt';
import { getDevices, getAlerts, getTelemetryHistory } from '../lib/api';
import { getToken, clearToken } from '../lib/auth';
import { withScheme } from '../lib/url';
import DeviceCard from '../components/DeviceCard';
import AlertList from '../components/AlertList';
// recharts is by far the heaviest dependency here and is only needed once a
// device is selected, so it loads as its own chunk instead of being paid for
// on every first page load.
const TelemetryChart = lazy(() => import('../components/TelemetryChart'));

const MQTT_WS_URL = withScheme(import.meta.env.VITE_MQTT_WS_URL, 'wss');
const TELEMETRY_PREFIX = 'telemetry/';
const MAX_LIVE_POINTS = 300;

export default function Dashboard() {
  const [devices, setDevices] = useState([]);
  const [readings, setReadings] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  // History is keyed by the device it belongs to, so selecting a different
  // device renders empty rather than briefly charting the previous device's
  // data while the new fetch is still in flight.
  const [history, setHistory] = useState({ deviceId: null, rows: [] });
  const [metric, setMetric] = useState('temperature');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const token = getToken();
    if (!token) {
      navigate('/login');
      return;
    }

    getDevices().then(setDevices).catch(() => setError('Could not load devices'));
    getAlerts().then(setAlerts).catch(() => setError('Could not load alerts'));
    const alertPoll = setInterval(() => {
      getAlerts().then(setAlerts).catch(() => {});
    }, 10000);

    // Connect as a VIEWER — username "dashboard", password = the same
    // JWT used for REST calls. The broker verifies this locally, then
    // filters deliveries to the devices this user is allowed to see.
    const client = mqtt.connect(MQTT_WS_URL, { username: 'dashboard', password: token });

    client.on('connect', () => {
      client.subscribe(`${TELEMETRY_PREFIX}#`);
    });

    client.on('message', (topic, payload) => {
      // The device id comes from the TOPIC, not the payload — devices publish
      // only their sensor values, and the broker already enforces that a device
      // can publish to no topic but its own. Reading it off the payload (which
      // has no deviceId field) silently bucketed every device under "undefined",
      // so no card ever showed a live value.
      if (!topic.startsWith(TELEMETRY_PREFIX)) return;
      const deviceId = topic.slice(TELEMETRY_PREFIX.length);

      let reading;
      try {
        reading = JSON.parse(payload.toString());
      } catch {
        return; // ignore malformed payloads
      }

      // Stamped here because receivedAt is added server-side on the way to
      // MongoDB; the forwarded live packet is the device's raw payload.
      const entry = { ...reading, deviceId, receivedAt: new Date().toISOString() };
      setReadings((prev) => ({ ...prev, [deviceId]: entry }));

      setHistory((prev) =>
        prev.deviceId === deviceId
          ? { deviceId, rows: [...prev.rows, entry].slice(-MAX_LIVE_POINTS) }
          : prev
      );
    });

    client.on('error', (err) => setError(`MQTT error: ${err.message}`));

    return () => {
      clearInterval(alertPoll);
      client.end(true);
    };
  }, [navigate]);

  // Durable history for whichever device is selected. Live points are appended
  // to this in the message handler above.
  useEffect(() => {
    if (!selectedDeviceId) return;
    let cancelled = false;
    getTelemetryHistory(selectedDeviceId)
      .then((rows) => {
        if (!cancelled) setHistory({ deviceId: selectedDeviceId, rows });
      })
      .catch(() => {
        if (!cancelled) setError('Could not load telemetry history');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDeviceId]);

  function handleLogout() {
    clearToken();
    navigate('/login');
  }

  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId);
  const historyRows = history.deviceId === selectedDeviceId ? history.rows : [];

  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Fleet Tracker</h1>
        <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-800">
          Log out
        </button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <section>
        <h2 className="text-sm font-medium text-slate-500 mb-2">Devices</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.map((device) => (
            <DeviceCard
              key={device.deviceId}
              device={device}
              reading={readings[device.deviceId]}
              selected={device.deviceId === selectedDeviceId}
              onSelect={() =>
                setSelectedDeviceId((current) =>
                  current === device.deviceId ? null : device.deviceId
                )
              }
            />
          ))}
          {devices.length === 0 && <p className="text-sm text-slate-400">No devices registered yet.</p>}
        </div>
      </section>

      {selectedDevice && (
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-500">
              History · <span className="text-slate-800">{selectedDevice.label}</span>
            </h2>
            <button
              onClick={() => setSelectedDeviceId(null)}
              className="text-xs text-slate-400 hover:text-slate-700"
            >
              Close
            </button>
          </div>
          <Suspense fallback={<p className="text-sm text-slate-400">Loading chart…</p>}>
            <TelemetryChart readings={historyRows} metric={metric} onMetricChange={setMetric} />
          </Suspense>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium text-slate-500 mb-2">Recent alerts</h2>
        <AlertList alerts={alerts} />
      </section>
    </div>
  );
}
