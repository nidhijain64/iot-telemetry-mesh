import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isExpiredSession, handleResponseError } from '../api';

// Shapes an axios error the way axios actually builds one.
function axiosError(status, { authenticated = false, path = '/api/devices' } = {}) {
  return {
    response: { status },
    config: { url: path, headers: authenticated ? { Authorization: 'Bearer tok' } : {} },
  };
}

describe('isExpiredSession', () => {
  it('is true for a 401 on a request that carried a token', () => {
    expect(isExpiredSession(axiosError(401, { authenticated: true }))).toBe(true);
  });

  it('is false for a 401 from login — that is a wrong password, not an expiry', () => {
    expect(isExpiredSession(axiosError(401, { path: '/api/auth/login' }))).toBe(false);
  });

  it('is false for a 403 — authenticated, just not permitted', () => {
    expect(isExpiredSession(axiosError(403, { authenticated: true }))).toBe(false);
  });

  it('is false for a network error with no response', () => {
    expect(isExpiredSession({ message: 'Network Error', config: { headers: {} } })).toBe(false);
  });

  it('does not throw on a malformed error', () => {
    expect(isExpiredSession(undefined)).toBe(false);
    expect(isExpiredSession({})).toBe(false);
  });
});

// Map-backed stand-in for localStorage — enough for the token helpers, and
// cheaper than pulling a whole DOM implementation in for four assertions.
function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

describe('handleResponseError', () => {
  let replace;
  let storage;

  beforeEach(() => {
    storage = fakeStorage({ iot_dashboard_token: 'stale-token' });
    replace = vi.fn();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { location: { pathname: '/', replace } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears the stale token and sends the user to login', async () => {
    const err = axiosError(401, { authenticated: true });
    await expect(handleResponseError(err)).rejects.toBe(err);

    expect(storage.getItem('iot_dashboard_token')).toBeNull();
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('leaves a failed login alone so the form can show the error', async () => {
    const err = axiosError(401, { path: '/api/auth/login' });
    await expect(handleResponseError(err)).rejects.toBe(err);

    expect(storage.getItem('iot_dashboard_token')).toBe('stale-token');
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not redirect when already on the login page', async () => {
    vi.stubGlobal('window', { location: { pathname: '/login', replace } });
    const err = axiosError(401, { authenticated: true });
    await expect(handleResponseError(err)).rejects.toBe(err);

    expect(replace).not.toHaveBeenCalled();
  });

  it('passes non-auth failures straight through untouched', async () => {
    const err = axiosError(500, { authenticated: true });
    await expect(handleResponseError(err)).rejects.toBe(err);

    expect(storage.getItem('iot_dashboard_token')).toBe('stale-token');
    expect(replace).not.toHaveBeenCalled();
  });
});
