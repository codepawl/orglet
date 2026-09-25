import { describe, expect, it } from 'vitest';
import { filesAddedWith } from '../../apps/desktop/src/renderer/turnFiles';

const file = (id: string) => ({ id, name: `${id}.pdf` });

describe('files shown above a message (COD-263)', () => {
  it('shows every file on the first message', () => {
    expect(filesAddedWith([file('a'), file('b')], undefined)).toEqual([file('a'), file('b')]);
  });

  it('shows only the files a later message added, not the ones the chat already had', () => {
    expect(filesAddedWith([file('a'), file('b')], [file('a'), file('b')])).toEqual([]);
    expect(filesAddedWith([file('a'), file('b'), file('c')], [file('a'), file('b')])).toEqual([file('c')]);
  });

  it('shows a file again when it was removed and then attached anew', () => {
    expect(filesAddedWith([file('a')], [])).toEqual([file('a')]);
  });
});
