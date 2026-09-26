import { expect, it } from 'vitest';
import { regionAround } from '../../apps/desktop/src/browser/engine';

const viewport = { width: 1280, height: 800 };

// COD-292: the card's picture is framed on the element with room around it, not a fixed 720-wide cut.
it('frames a small element with its neighbours in a 16:9 picture', () => {
  const button = { x: 600, y: 150, width: 80, height: 20 };
  const region = regionAround(button, viewport);
  expect(region).toEqual({ x: 400, y: 25, width: 480, height: 270 });
  expect(region.x).toBeLessThanOrEqual(button.x);
  expect(region.x + region.width).toBeGreaterThanOrEqual(button.x + button.width);
});

it('never grows past 720 by 405 and stays inside the page', () => {
  expect(regionAround({ x: 100, y: 100, width: 1000, height: 600 }, viewport)).toEqual({ x: 240, y: 198, width: 720, height: 405 });
  const nearCorner = regionAround({ x: 1250, y: 780, width: 20, height: 10 }, viewport);
  expect(nearCorner.x + nearCorner.width).toBe(viewport.width);
  expect(nearCorner.y + nearCorner.height).toBe(viewport.height);
});
