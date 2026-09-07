import axios from 'axios';
import { getToken, clearToken } from './auth';
import { withScheme } from './url';

// One entry point now, instead of 4 separate service URLs.
const API_URL = withScheme(import.meta.env.VITE_API_URL, 'https');

export const client = axios.create({ baseURL: API_URL });

// Attached once here rather than spelled out at every call site, so a new
// endpoint can't silently ship unauthenticated.
client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// True only for a 401 on a request that DID carry a token — i.e. the session
// expired or was revoked. A 401 from /login is a wrong password: the login form
// needs to show that error, not be bounced to the page it is already on.
export function isExpiredSession(error) {
  return error?.response?.status === 401 && Boolean(error?.config?.headers?.Authorization);
}

// JWTs last an hour. Without this, leaving the dashboard open past expiry left
// every request failing and the UI stuck on "Could not load devices" forever,
// with no way back to the login form short of clearing localStorage by hand.
// Exported so the behaviour can be tested directly, rather than only through a
// mocked network round trip.
export function handleResponseError(error) {
  if (isExpiredSession(error)) {
    clearToken();
    // replace(), not assign() — the dead session's page shouldn't be sitting
    // in history for the back button to return to.
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
  }
  return Promise.reject(error);
}

client.interceptors.response.use((response) => response, handleResponseError);

export async function login(username, password) {
  const res = await client.post('/api/auth/login', { username, password });
  return res.data;
}

// Always creates an 'operator' — the API ignores any role sent from a client,
// so a new phone user can never sign themselves up as an admin.
export async function registerUser(username, password) {
  const res = await client.post('/api/auth/register', { username, password });
  return res.data;
}

export async function getDevices() {
  const res = await client.get('/api/devices');
  return res.data;
}

export async function getAlerts() {
  const res = await client.get('/api/alerts');
  return res.data;
}

export async function registerDevice(deviceId, label, type) {
  try {
    const res = await client.post('/api/devices', { deviceId, label, type });
    return res.data;
  } catch (err) {
    if (err.response?.status === 409) return null;
    throw err;
  }
}

export async function issueDeviceCredentials(deviceId) {
  const res = await client.post(`/api/devices/${deviceId}/credentials`, {});
  return res.data.secret;
}

// Durable history out of MongoDB (the ring buffer only covers the live window,
// and is empty after an ingestion-service restart).
export async function getTelemetryHistory(deviceId, limit = 200) {
  const res = await client.get(`/api/telemetry/${deviceId}/history`, { params: { limit } });
  return res.data;
}
