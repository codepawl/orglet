import { expect, it } from 'vitest';
import { isViteDevRequest, preferLoopbackIpv4 } from '../../apps/desktop/src/main/vite-dev-url';

it('rewrites Forge localhost to the IPv4 address Vite actually binds', () => {
  expect(preferLoopbackIpv4('http://localhost:5173')).toBe('http://127.0.0.1:5173/');
  expect(preferLoopbackIpv4('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173/');
});

it('allows Chromium to talk to Vite on localhost or 127.0.0.1 at the same port', () => {
  const forge = new URL('http://localhost:5173');
  expect(isViteDevRequest(new URL('http://127.0.0.1:5173/'), forge)).toBe(true);
  expect(isViteDevRequest(new URL('ws://127.0.0.1:5173/'), forge)).toBe(true);
  expect(isViteDevRequest(new URL('http://localhost:5173/@vite/client'), forge)).toBe(true);
  expect(isViteDevRequest(new URL('http://127.0.0.1:5174/'), forge)).toBe(false);
  expect(isViteDevRequest(new URL('https://127.0.0.1:5173/'), forge)).toBe(false);
  expect(isViteDevRequest(new URL('http://example.com:5173/'), forge)).toBe(false);
});
