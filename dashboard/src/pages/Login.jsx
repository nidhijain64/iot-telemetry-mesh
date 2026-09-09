import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../lib/api';
import { setToken } from '../lib/auth';

// Deliberately committed, not hidden in config: this deployment exists to be
// opened by strangers, so the credentials are part of the page rather than
// something a visitor has to be handed separately. Set the VITE_DEMO_* vars to
// point at a different account, or to blank to remove the panel entirely.
const DEMO_USERNAME = import.meta.env.VITE_DEMO_USERNAME ?? 'admin1';
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD ?? 'FleetAdmin2026';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function signIn(user, pass) {
    setError('');
    try {
      const { token } = await login(user, pass);
      setToken(token);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    signIn(username, password);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-md w-80 space-y-4">
        <h1 className="text-xl font-semibold text-slate-800">Fleet Tracker Login</h1>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <input
          className="w-full border border-slate-300 rounded-lg px-3 py-2"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="w-full border border-slate-300 rounded-lg px-3 py-2"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="w-full bg-slate-800 text-white rounded-lg py-2 font-medium hover:bg-slate-700">
          Log in
        </button>

        {DEMO_USERNAME && DEMO_PASSWORD && (
          <div className="pt-3 border-t border-slate-200 space-y-2">
            <p className="text-xs text-slate-500">
              Just looking around? Sign in with the demo account:
            </p>
            <p className="text-xs font-mono text-slate-700 bg-slate-100 rounded px-2 py-1.5">
              {DEMO_USERNAME} &nbsp;/&nbsp; {DEMO_PASSWORD}
            </p>
            <button
              type="button"
              onClick={() => {
                setUsername(DEMO_USERNAME);
                setPassword(DEMO_PASSWORD);
                signIn(DEMO_USERNAME, DEMO_PASSWORD);
              }}
              className="w-full border border-slate-300 text-slate-700 rounded-lg py-2 text-sm font-medium hover:border-slate-500"
            >
              Sign in as demo
            </button>
            <p className="text-xs text-slate-400">
              Services sleep when idle — the first load can take up to a minute.
            </p>
          </div>
        )}
      </form>
    </div>
  );
}
