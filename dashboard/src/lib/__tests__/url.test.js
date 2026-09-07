import { describe, it, expect } from 'vitest';
import { withScheme } from '../url';

describe('withScheme', () => {
  it('adds wss:// to a bare MQTT host', () => {
    expect(withScheme('ingest.onrender.com', 'wss')).toBe('wss://ingest.onrender.com');
  });

  it('adds https:// to a bare API host', () => {
    expect(withScheme('gw.onrender.com', 'https')).toBe('https://gw.onrender.com');
  });

  it('leaves an explicit scheme alone, including local ws://', () => {
    expect(withScheme('ws://localhost:3003', 'wss')).toBe('ws://localhost:3003');
    expect(withScheme('http://localhost:3005', 'https')).toBe('http://localhost:3005');
  });

  it('strips trailing slashes', () => {
    expect(withScheme('https://gw.onrender.com/', 'https')).toBe('https://gw.onrender.com');
  });

  it('returns empty for an unset value rather than "https://undefined"', () => {
    expect(withScheme(undefined, 'https')).toBe('');
    expect(withScheme('', 'https')).toBe('');
  });
});
