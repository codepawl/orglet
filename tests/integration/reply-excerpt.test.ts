import { describe, expect, it } from 'vitest';
import { plainExcerptLine } from '../../apps/desktop/src/renderer/components/messageMarks';

describe('reply excerpt', () => {
  it('shows a heading without its hashes', () => {
    expect(plainExcerptLine('## Tôi là ai\n\nMột worker.')).toBe('Tôi là ai');
  });

  it('drops list, quote, emphasis, code and link syntax', () => {
    expect(plainExcerptLine('- **Bold** and `code`')).toBe('Bold and code');
    expect(plainExcerptLine('> see [the docs](https://example.com)')).toBe('see the docs');
    expect(plainExcerptLine('1. _first_ step')).toBe('first step');
  });

  it('skips blank lines and code fences', () => {
    expect(plainExcerptLine('\n\n```ts\nconst answer = 42;\n```')).toBe('const answer = 42;');
  });
});
