import { afterEach, expect, it, vi } from 'vitest';
import { getToken, setToken, clearToken } from '../auth';
function storage() {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) };
}
afterEach(() => vi.unstubAllGlobals());
it('keeps account switching and logout confined to each tab', () => {
  const first = storage();
  const second = storage();
  vi.stubGlobal('sessionStorage', first);
  setToken('alice');
  vi.stubGlobal('sessionStorage', second);
  setToken('bob');
  clearToken();
  expect(getToken()).toBeNull();
  vi.stubGlobal('sessionStorage', first);
  expect(getToken()).toBe('alice');
});
