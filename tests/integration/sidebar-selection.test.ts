import { describe, expect, it } from 'vitest';
import { noSelection, pruneSelection, selectRange, selectionPickMode, toggleSelection, type SidebarSelection } from '../../apps/desktop/src/renderer/sidebarSelection';

const order = ['a', 'b', 'c', 'd', 'e'];
const workers = (ids: string[], anchor: string | null = ids[ids.length - 1] ?? null): SidebarSelection => ({ section: 'workers', ids, anchor });

describe('selectionPickMode', () => {
  it('reads Shift as a range, Ctrl or Cmd as a toggle, and nothing else as a plain click', () => {
    expect(selectionPickMode({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe('range');
    expect(selectionPickMode({ shiftKey: true, ctrlKey: true, metaKey: false })).toBe('range');
    expect(selectionPickMode({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe('toggle');
    expect(selectionPickMode({ shiftKey: false, ctrlKey: false, metaKey: true })).toBe('toggle');
    expect(selectionPickMode({ shiftKey: false, ctrlKey: false, metaKey: false })).toBeNull();
  });
});

describe('toggleSelection', () => {
  it('starts a selection with the row as its anchor', () => {
    expect(toggleSelection(noSelection, 'workers', order, 'c')).toEqual(workers(['c']));
  });

  it('keeps the ids in list order whatever order they were picked in', () => {
    const picked = toggleSelection(toggleSelection(workers(['d']), 'workers', order, 'a'), 'workers', order, 'c');
    expect(picked).toEqual(workers(['a', 'c', 'd'], 'c'));
  });

  it('takes a selected row out and moves the anchor off it', () => {
    expect(toggleSelection(workers(['a', 'c', 'd'], 'c'), 'workers', order, 'c')).toEqual(workers(['a', 'd'], 'd'));
    expect(toggleSelection(workers(['a', 'c', 'd'], 'a'), 'workers', order, 'c')).toEqual(workers(['a', 'd'], 'a'));
  });

  it('clears the selection when the last row is taken out', () => {
    expect(toggleSelection(workers(['b']), 'workers', order, 'b')).toEqual(noSelection);
  });

  it('starts over in the other section instead of mixing crews and orglets', () => {
    expect(toggleSelection(workers(['a', 'b']), 'teams', ['t1', 't2'], 't2')).toEqual({ section: 'teams', ids: ['t2'], anchor: 't2' });
  });
});

describe('selectRange', () => {
  it('selects everything between the anchor and the row, in either direction', () => {
    expect(selectRange(workers(['b']), 'workers', order, 'd')).toEqual(workers(['b', 'c', 'd'], 'b'));
    expect(selectRange(workers(['d']), 'workers', order, 'b')).toEqual(workers(['b', 'c', 'd'], 'd'));
  });

  it('replaces the selection with the range and keeps the anchor, so the next Shift-click ranges from the same place', () => {
    const first = selectRange(workers(['a']), 'workers', order, 'e');
    expect(first).toEqual(workers(['a', 'b', 'c', 'd', 'e'], 'a'));
    const shrunk = selectRange(first, 'workers', order, 'b');
    expect(shrunk).toEqual(workers(['a', 'b'], 'a'));
    const replaced = selectRange(workers(['a', 'e'], 'e'), 'workers', order, 'c');
    expect(replaced).toEqual(workers(['c', 'd', 'e'], 'e'));
  });

  it('selects only the row when there is no anchor in that section', () => {
    expect(selectRange(noSelection, 'workers', order, 'c')).toEqual(workers(['c']));
    expect(selectRange(workers(['a', 'b']), 'teams', ['t1', 't2', 't3'], 't3')).toEqual({ section: 'teams', ids: ['t3'], anchor: 't3' });
  });

  it('ignores a row that is not in the list', () => {
    const current = workers(['a']);
    expect(selectRange(current, 'workers', order, 'zz')).toBe(current);
  });
});

describe('pruneSelection', () => {
  it('drops rows that left the list and keeps the anchor when it is still there', () => {
    expect(pruneSelection(workers(['a', 'c', 'd'], 'a'), ['a', 'b', 'd'])).toEqual(workers(['a', 'd'], 'a'));
  });

  it('moves the anchor to the last remaining row when the anchor left', () => {
    expect(pruneSelection(workers(['a', 'c', 'd'], 'c'), ['a', 'b', 'd'])).toEqual(workers(['a', 'd'], 'd'));
  });

  it('clears the selection when every selected row left, and returns the same object when nothing changed', () => {
    expect(pruneSelection(workers(['c']), ['a', 'b'])).toEqual(noSelection);
    const current = workers(['a', 'b']);
    expect(pruneSelection(current, order)).toBe(current);
    expect(pruneSelection(noSelection, [])).toBe(noSelection);
  });
});
