import { useState, useRef } from 'react';
import mqtt from 'mqtt';
import { login, registerUser, registerDevice, issueDeviceCredentials } from '../lib/api';
import { getToken, setToken, clearToken } from '../lib/auth';
import { withScheme } from '../lib/url';

function secretKey(deviceId) {
  return `mobile_secret_${deviceId}`;
}

const BROWSER_ID_KEY = 'iot_browser_id';

// A device id built from the username alone made every phone belonging to one
// account the SAME device: both published to telemetry/phone-<user>, so the
// dashboard showed a single card flickering between them — and issuing
// credentials for the second phone invalidated the first one's secret, silently
// disconnecting it. This suffix is generated once per browser and kept in
// localStorage, so each phone is its own device and keeps its own credentials.
function browserId() {
  let id = null;
  try {
    id = localStorage.getItem(BROWSER_ID_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 8);
      localStorage.setItem(BROWSER_ID_KEY, id);
    }
  } catch {
    // Private mode with storage blocked — fall back to a per-session id so the
    // page still works, at the cost of registering a new device each visit.
    id = Math.random().toString(36).slice(2, 8);
  }
  return id;
}

export default function MobileNode() {
  const [token, setLocalToken] = useState(getToken());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [busy, setBusy] = useState(false);

  const [label, setLabel] = useState(() => `${/Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'Browser'} node`);
  const [issuedSecret, setIssuedSecret] = useState(null);

  // Both derived during render rather than synced through an effect: deviceId is
  // a pure function of the username, and the cached secret is a pure function of
  // deviceId. Writing them into state from an effect only added a second render
  // pass that could show a stale deviceId in between.
  const deviceId = username ? `phone-${username}-${browserId()}` : '';
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
  const orientationRef = useRef(null);
  const locationRef = useRef(null);
  const geoWatchRef = useRef(null);
  const intervalRef = useRef(null);

  function appendLog(msg) {
    setLog((prev) => `${msg}\n${prev}`.slice(0, 2000));
  }

  // Sign-up and sign-in share a handler: registering returns no token, so a new
  // account is logged in straight afterwards rather than making someone type
  // the same credentials twice on a phone keyboard.
  async function handleLogin(e) {
    e.preventDefault();
    setLoginError('');
    setBusy(true);
    try {
      if (isSignUp) {
        await registerUser(username, password);
      }
      const { token: newToken } = await login(username, password);
      setToken(newToken);
      setLocalToken(newToken);
    } catch (err) {
      const msg = err.response?.data?.error;
      if (isSignUp && err.response?.status === 409) {
        setLoginError('That username is taken — try logging in instead.');
      } else {
        setLoginError(msg || (isSignUp ? 'Could not create account' : 'Login failed'));
      }
    } finally {
      setBusy(false);
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

    // One continuous GPS watch instead of a fresh fix per reading. Asking for a
    // position every publish gave iOS Safari 3 seconds to acquire one, which it
    // almost never manages — location was missing from every single iPhone
    // reading while Android, which answers from cache, looked fine. A watch
    // acquires once and then updates as the device moves, so publishing reads a
    // value that is already there. maximumAge lets it reuse a recent fix rather
    // than waking the GPS each time and draining the battery.
    if (navigator.geolocation) {
      geoWatchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          locationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        },
        (err) => appendLog(`Location unavailable: ${err.message}`),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 }
      );
    }

    // Tilt. iOS gates this behind the same permission prompt as motion, which
    // requestPermission() above has already answered for both.
    window.addEventListener('deviceorientation', (event) => {
      if (event.alpha === null && event.beta === null && event.gamma === null) return;
      orientationRef.current = { alpha: event.alpha, beta: event.beta, gamma: event.gamma };
    });

    try {
      // All three are ON by default and all three are wrong for measuring a
      // room. Echo cancellation subtracts this device's own speaker output, so
      // music playing on the phone reads as near-silence. Auto gain control
      // normalises level, which is precisely the signal being measured — it
      // pins loud and quiet to roughly the same number. Noise suppression
      // strips the ambient sound that is the whole point here.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // Safari starts an AudioContext suspended, and a suspended context feeds
      // the analyser nothing but silence.
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
    } catch (err) {
      appendLog(`Microphone permission error: ${err.message} — sound level unavailable.`);
    }

    const client = mqtt.connect(withScheme(import.meta.env.VITE_MQTT_WS_URL, 'wss'), { username: deviceId, password: secret });
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

    if (locationRef.current) reading.location = locationRef.current;

    reading.motion = motionRef.current;
    if (orientationRef.current) reading.orientation = orientationRef.current;

    const db = getSoundLevelDb();
    if (db !== null) reading.soundLevel = db;

    setLastReading(reading);

    if (clientRef.current && clientRef.current.connected) {
      clientRef.current.publish(`telemetry/${deviceId}`, JSON.stringify(reading));
    }
  }

  function stopMonitoring() {
    clearInterval(intervalRef.current);
    if (geoWatchRef.current !== null) {
      navigator.geolocation.clearWatch(geoWatchRef.current);
      geoWatchRef.current = null;
    }
    if (clientRef.current) clientRef.current.end(true);
    if (audioCtxRef.current) audioCtxRef.current.close();
    setStatus('idle');
    appendLog('Stopped.');
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-6">
        <form onSubmit={handleLogin} className="bg-slate-800 p-8 rounded-xl w-80 space-y-4">
          <h1 className="text-xl font-semibold">
            {isSignUp ? 'Create an account for this phone' : 'Log in to send data from this phone'}
          </h1>
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
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {isSignUp && <p className="text-xs text-slate-400">At least 8 characters.</p>}
          <button
            disabled={busy}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg py-2 font-medium"
          >
            {busy ? 'Please wait…' : isSignUp ? 'Create account' : 'Log in'}
          </button>
          <button
            type="button"
            onClick={() => { setIsSignUp(!isSignUp); setLoginError(''); }}
            className="w-full text-sm text-slate-400 hover:text-white"
          >
            {isSignUp ? 'Already have an account? Log in' : 'New here? Create an account'}
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
