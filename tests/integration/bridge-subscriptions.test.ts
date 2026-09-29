import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The renderer's `orglet` proxy wraps every bridge method as async so it can translate errors, except the
 * subscriptions, which must hand back their unsubscribe function at once. A subscription missing from that list
 * returns a Promise instead, and the component that calls it on unmount throws: closing Settings blanked the window
 * this way while Tacet's block (COD-303) was being built.
 */
const preloadSource = readFileSync(resolve(__dirname, '../../apps/desktop/src/preload/index.ts'), 'utf8');
// Only the `orglet` bridge goes through that proxy. The desktop glow's `orgletOverlay` bridge (COD-261), exposed after
// it, is called directly by its own window.
const preload = preloadSource.slice(0, preloadSource.indexOf(`exposeInMainWorld('orglet',`));
const proxy = readFileSync(resolve(__dirname, '../../apps/desktop/src/renderer/api.ts'), 'utf8');

describe('bridge subscriptions', () => {
  it('reach the renderer unwrapped, so their unsubscribe is a function', () => {
    const subscriptions = [...preload.matchAll(/^\s+(on[A-Z]\w*):/gm)].map(match => match[1]);
    expect(subscriptions).toContain('onDecisionModel');
    const wrapped = subscriptions.filter(name => !proxy.includes(`key === '${name}'`));
    expect(wrapped).toEqual([]);
  });
});
