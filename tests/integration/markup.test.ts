import { describe, expect, it } from 'vitest';
import {
  arrowHead, commit, cropFrom, emptyMarkup, exportFrame, extendStroke, isChanged, paintMarkup, redo, startHistory,
  strokeWidth, textSize, undo, type Markup, type StrokeMark,
} from '../../apps/desktop/src/renderer/markup';

const pen = (x: number): StrokeMark => ({ kind: 'pen', points: [{ x, y: 0 }], color: '#ff0000', width: 4 });

describe('markup history', () => {
  it('undoes and redoes marks and a crop in order, and a new mark drops what was undone', () => {
    let history = startHistory();
    expect(isChanged(history.present)).toBe(false);
    history = commit(history, { marks: [pen(1)] });
    history = commit(history, { marks: [pen(1), pen(2)] });
    history = commit(history, { ...history.present, crop: { x: 0, y: 0, width: 10, height: 10 } });
    expect(isChanged(history.present)).toBe(true);
    history = undo(history);
    expect(history.present.crop).toBeUndefined();
    expect(history.present.marks).toHaveLength(2);
    history = undo(history);
    history = undo(history);
    expect(history.present).toBe(emptyMarkup);
    expect(undo(history)).toBe(history);
    history = redo(history);
    expect(history.present.marks).toHaveLength(1);
    history = commit(history, { marks: [pen(1), pen(9)] });
    expect(history.future).toEqual([]);
    expect(redo(history)).toBe(history);
  });

  it('keeps two hundred steps of undo', () => {
    let history = startHistory();
    for (let step = 0; step < 250; step += 1) history = commit(history, { marks: [pen(step)] });
    expect(history.past).toHaveLength(200);
  });
});

describe('cropping', () => {
  const size = { width: 400, height: 300 };

  it('takes a crop dragged any way round, on whole pixels, inside the picture', () => {
    expect(cropFrom({ x: 300.6, y: 250.2 }, { x: 100.4, y: 50.7 }, size)).toEqual({ x: 100, y: 51, width: 201, height: 199 });
    expect(cropFrom({ x: -20, y: -5 }, { x: 900, y: 120 }, size)).toEqual({ x: 0, y: 0, width: 400, height: 120 });
  });

  it('reads a click as no crop', () => {
    expect(cropFrom({ x: 10, y: 10 }, { x: 13, y: 40 }, size)).toBeUndefined();
  });

  it('saves the crop, or the whole picture, as the exported frame', () => {
    expect(exportFrame(size)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(exportFrame(size, { x: 20, y: 30, width: 120, height: 80 })).toEqual({ x: 20, y: 30, width: 120, height: 80 });
  });
});

describe('sizes and shapes', () => {
  it('sizes strokes and text to the picture, never below the screen size', () => {
    expect(strokeWidth('medium', { width: 800, height: 600 })).toBe(4);
    expect(strokeWidth('medium', { width: 4000, height: 3000 })).toBe(16);
    expect(strokeWidth('thin', { width: 200, height: 100 })).toBe(2);
    expect(textSize('thick', { width: 2000, height: 500 })).toBe(72);
  });

  it('points the arrow head back from the tip on both sides of the shaft', () => {
    const [left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(left.x).toBeLessThan(100);
    expect(right.x).toBeLessThan(100);
    expect(left.y).toBeCloseTo(-right.y);
  });

  it('skips pen samples too close to the last one', () => {
    const stroke = pen(0);
    expect(extendStroke(stroke, { x: 0.5, y: 0 }, 1.5)).toBe(stroke);
    expect(extendStroke(stroke, { x: 3, y: 0 }, 1.5).points).toHaveLength(2);
  });
});

describe('painting', () => {
  /** A canvas context that only records what it was asked to do. */
  function recorder() {
    const calls: string[] = [];
    const context = new Proxy({}, {
      get: (_target, property: string) => (...values: unknown[]) => { calls.push(`${property}(${values.filter(value => typeof value === 'number').join(',')})`); },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    return { calls, context };
  }

  it('shifts the picture so the crop lands at the origin of the saved image, then draws every mark', () => {
    const { calls, context } = recorder();
    const markup: Markup = { marks: [pen(5), { kind: 'rectangle', from: { x: 1, y: 1 }, to: { x: 30, y: 20 }, color: '#000', width: 2 }], crop: { x: 20, y: 30, width: 120, height: 80 } };
    paintMarkup(context, {} as CanvasImageSource, { width: 400, height: 300 }, markup, exportFrame({ width: 400, height: 300 }, markup.crop));
    expect(calls[1]).toBe('translate(-20,-30)');
    expect(calls[2]).toBe('drawImage(0,0,400,300)');
    expect(calls.filter(call => call.startsWith('stroke('))).toHaveLength(2);
    expect(calls.some(call => call.startsWith('roundRect('))).toBe(true);
  });
});
