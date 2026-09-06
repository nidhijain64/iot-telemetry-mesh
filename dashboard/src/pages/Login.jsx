import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../lib/api';
import { setToken } from '../lib/auth';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const { token } = await login(username, password);
      setToken(token);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    }
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
      </form>
    </div>
  );
}
