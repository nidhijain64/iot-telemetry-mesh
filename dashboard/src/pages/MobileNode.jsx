import { useState, useRef } from 'react';
import mqtt from 'mqtt';
import { login, registerDevice, issueDeviceCredentials } from '../lib/api';
import { getToken, setToken, clearToken } from '../lib/auth';

function secretKey(deviceId) {
  return `mobile_secret_${deviceId}`;
}

export default function MobileNode() {
  const [token, setLocalToken] = useState(getToken());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [label, setLabel] = useState('My Phone');
  const [issuedSecret, setIssuedSecret] = useState(null);

  // Both derived during render rather than synced through an effect: deviceId is
  // a pure function of the username, and the cached secret is a pure function of
  // deviceId. Writing them into state from an effect only added a second render
  // pass that could show a stale deviceId in between.
  const deviceId = username ? `phone-${username}` : '';
  const cachedSecret = deviceId ? localStorage.getItem(secretKey(deviceId)) : null;
  const secret = issuedSecret ?? cachedSecret;
  const [settingUp, setSettingUp] = useState(false);
  const [setupError, setSetupError] = useState('');

  const [status, setStatus] = useState('idle');
  const [lastReading, setLastReading] = useState(null);
  const [log, setLog] = useState('');

  const clientRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const motionRef = useRef({ x: 0, y: 0, z: 0 });
  const intervalRef = useRef(null);

  function appendLog(msg) {
    setLog((prev) => `${msg}\n${prev}`.slice(0, 2000));
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError('');
    try {
      const { token: newToken } = await login(username, password);
      setToken(newToken);
      setLocalToken(newToken);
    } catch (err) {
      setLoginError(err.response?.data?.error || 'Login failed');
    }
  }

  function handleLogout() {
    clearToken();
    setLocalToken(null);
    setUsername('');
    setPassword('');
    setIssuedSecret(null);
  }

  async function setupDevice() {
    setSettingUp(true);
    setSetupError('');
    try {
      await registerDevice(deviceId, label, 'mobile-browser');
      const newSecret = await issueDeviceCredentials(deviceId);
      localStorage.setItem(secretKey(deviceId), newSecret);
      setIssuedSecret(newSecret);
    } catch (err) {
      setSetupError(err.response?.data?.error || 'Could not set up device');
    } finally {
      setSettingUp(false);
    }
  }

  async function startMonitoring() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const result = await DeviceMotionEvent.requestPermission();
        if (result !== 'granted') appendLog('Motion permission denied — tilt data unavailable.');
      } catch (err) {
        appendLog(`Motion permission error: ${err.message}`);
      }
    }

    window.addEventListener('devicemotion', (event) => {
      const acc = event.accelerationIncludingGravity;
      if (acc) motionRef.current = { x: acc.x, y: acc.y, z: acc.z };
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
    } catch (err) {
      appendLog(`Microphone permission error: ${err.message} — sound level unavailable.`);
    }

    const client = mqtt.connect(import.meta.env.VITE_MQTT_WS_URL, { username: deviceId, password: secret });
    clientRef.current = client;

    client.on('connect', () => {
      setStatus('monitoring');
      appendLog('Connected to broker.');
      intervalRef.current = setInterval(publishReading, 5000);
    });

    client.on('error', (err) => {
      setStatus('error');
      appendLog(`MQTT error: ${err.message}`);
    });
  }

  function getSoundLevelDb() {
    const analyser = analyserRef.current;
    if (!analyser) return null;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const db = 20 * Math.log10(rms || 0.0001) + 100;
    return Math.round(db * 10) / 10;
  }

  async function publishReading() {
    const reading = { source: 'mobile-browser' };

    if (navigator.getBattery) {
      try {
        const battery = await navigator.getBattery();
        reading.batteryLevel = Math.round(battery.level * 100);
      } catch {
        // not available — omit rather than fake it
      }
    }

    await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve();
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          reading.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          resolve();
        },
        () => resolve(),
        { timeout: 3000 }
      );
    });

    reading.motion = motionRef.current;

    const db = getSoundLevelDb();
    if (db !== null) reading.soundLevel = db;

    setLastReading(reading);

    if (clientRef.current && clientRef.current.connected) {
      clientRef.current.publish(`telemetry/${deviceId}`, JSON.stringify(reading));
    }
  }

  function stopMonitoring() {
    clearInterval(intervalRef.current);
    if (clientRef.current) clientRef.current.end(true);
    if (audioCtxRef.current) audioCtxRef.current.close();
    setStatus('idle');
    appendLog('Stopped.');
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-6">
        <form onSubmit={handleLogin} className="bg-slate-800 p-8 rounded-xl w-80 space-y-4">
          <h1 className="text-xl font-semibold">Log in to send data from this phone</h1>
          {loginError && <p className="text-red-400 text-sm">{loginError}</p>}
          <input
            className="w-full bg-slate-700 rounded-lg px-3 py-2"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="w-full bg-slate-700 rounded-lg px-3 py-2"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="w-full bg-emerald-600 hover:bg-emerald-500 rounded-lg py-2 font-medium">
            Log in
          </button>
        </form>
      </div>
    );
  }

  if (!secret) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-6">
        <div className="bg-slate-800 p-8 rounded-xl w-80 space-y-4">
          <h1 className="text-xl font-semibold">Set up this phone</h1>
          <input
            className="w-full bg-slate-700 rounded-lg px-3 py-2"
            placeholder="Device label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <p className="text-xs text-slate-400">Device ID: {deviceId}</p>
          {setupError && <p className="text-red-400 text-sm">{setupError}</p>}
          <button
            onClick={setupDevice}
            disabled={settingUp}
            className="w-full bg-emerald-600 hover:bg-emerald-500 rounded-lg py-2 font-medium disabled:opacity-50"
          >
            {settingUp ? 'Setting up…' : 'Set up device'}
          </button>
          <button onClick={handleLogout} className="w-full text-slate-400 text-sm">
            Log out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Mobile Node — {deviceId}</h1>
        <button onClick={handleLogout} className="text-sm text-slate-400 hover:text-white">
          Log out
        </button>
      </div>
      <p className="text-sm text-slate-400">
        Publishes real sensor data — battery (Android Chrome only), location,
        motion, and ambient sound level.
      </p>

      {status !== 'monitoring' ? (
        <button onClick={startMonitoring} className="w-full bg-emerald-600 hover:bg-emerald-500 rounded-lg py-3 font-medium">
          Start Monitoring
        </button>
      ) : (
        <button onClick={stopMonitoring} className="w-full bg-red-600 hover:bg-red-500 rounded-lg py-3 font-medium">
          Stop
        </button>
      )}

      {lastReading && (
        <div className="bg-slate-800 rounded-lg p-4 text-sm space-y-1">
          <p className="text-slate-400">Last published reading:</p>
          <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(lastReading, null, 2)}</pre>
        </div>
      )}

      <div className="bg-black/40 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
        {log || 'Log output will appear here.'}
      </div>
    </div>
  );
}
