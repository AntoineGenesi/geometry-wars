import { describe, expect, it } from 'vitest';
import { getFrontendOriginRedirectUrl } from '../../server/FrontendOriginRedirect';

describe('backend frontend-origin redirect', () => {
  it('redirects backend-origin page navigations to the frontend port in development', () => {
    const location = getFrontendOriginRedirectUrl({
      method: 'GET',
      url: '/?mode=network&surface=sphere',
      host: 'localhost:2567',
      accept: 'text/html,application/xhtml+xml',
      nodeEnv: 'development',
    });

    expect(location).toBe('http://localhost:3000/?mode=network&surface=sphere');
  });

  it('preserves host and short-code path when steering LAN scans back to Vite', () => {
    const location = getFrontendOriginRedirectUrl({
      method: 'GET',
      url: '/12345',
      host: '192.168.1.25:2567',
      accept: 'text/html',
    });

    expect(location).toBe('http://192.168.1.25:3000/12345');
  });

  it('does not redirect backend API, matchmake, websocket, or static asset requests', () => {
    const base = {
      method: 'GET',
      host: 'localhost:2567',
      accept: 'text/html,*/*',
    };

    expect(getFrontendOriginRedirectUrl({ ...base, url: '/health' })).toBeNull();
    expect(getFrontendOriginRedirectUrl({ ...base, url: '/api/info' })).toBeNull();
    expect(getFrontendOriginRedirectUrl({ ...base, url: '/matchmake/joinOrCreate/game' })).toBeNull();
    expect(getFrontendOriginRedirectUrl({ ...base, url: '/ws' })).toBeNull();
    expect(getFrontendOriginRedirectUrl({ ...base, url: '/assets/index.js' })).toBeNull();
  });

  it('stays disabled for production static hosting and explicit opt-out', () => {
    const request = {
      method: 'GET',
      url: '/',
      host: 'example.test:2567',
      accept: 'text/html',
    };

    expect(getFrontendOriginRedirectUrl({ ...request, nodeEnv: 'production' })).toBeNull();
    expect(getFrontendOriginRedirectUrl({ ...request, disabled: true })).toBeNull();
  });

  it('uses the configured frontend port when the dev server is not on 3000', () => {
    const location = getFrontendOriginRedirectUrl({
      method: 'HEAD',
      url: '/enemy-types',
      host: 'localhost:2567',
      accept: 'text/html',
      frontendPort: 3042,
    });

    expect(location).toBe('http://localhost:3042/enemy-types');
  });
});
