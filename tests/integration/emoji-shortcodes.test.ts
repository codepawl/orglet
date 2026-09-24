import { describe, expect, it } from 'vitest';
import { completeShortcodeAt, emojiChoices, emojiForShortcode, insertEmoji, shortcodeQueryAt } from '../../apps/desktop/src/shared/emoji-shortcodes';

// COD-233: `:skull:` in the message box becomes 💀, and `:sk` offers the emoji that fit, but never over ordinary
// writing (the owner's condition, 2026-09-25).

describe('emoji shortcodes', () => {
  it('knows the GitHub names', () => {
    expect(emojiForShortcode('skull')).toBe('💀');
    expect(emojiForShortcode('Fire')).toBe('🔥');
    expect(emojiForShortcode('+1')).toBe('👍');
    expect(emojiForShortcode('not_an_emoji_name')).toBeUndefined();
  });

  it('turns a finished shortcode into its emoji the moment the closing colon is typed', () => {
    const text = 'nice :skull:';
    expect(completeShortcodeAt(text, text.length)).toEqual({ text: 'nice 💀', cursor: 'nice 💀'.length });
    const middle = ':fire: then more';
    expect(completeShortcodeAt(middle, 6)).toEqual({ text: '🔥 then more', cursor: '🔥'.length });
  });

  it('leaves an unknown or mid-word shortcode as written', () => {
    expect(completeShortcodeAt(':nothing_here:', 14)).toBeUndefined();
    expect(completeShortcodeAt('abc:skull:', 10)).toBeUndefined();
    expect(completeShortcodeAt('::', 2)).toBeUndefined();
  });

  it('only starts a shortcode at the beginning or after a space, and after two characters', () => {
    expect(shortcodeQueryAt(':sk', 3)).toEqual({ start: 0, query: 'sk' });
    expect(shortcodeQueryAt('lúc gõ ra :sk', 13)).toEqual({ start: 10, query: 'sk' });
    expect(shortcodeQueryAt('(:Sk', 4)).toEqual({ start: 1, query: 'sk' });
    expect(shortcodeQueryAt(':s', 2)).toBeUndefined();
    expect(shortcodeQueryAt('meet at 10:30', 13)).toBeUndefined();
    expect(shortcodeQueryAt('see https://example', 19)).toBeUndefined();
    expect(shortcodeQueryAt('Note: something', 15)).toBeUndefined();
    expect(shortcodeQueryAt('ratio 3:sk', 10)).toBeUndefined();
  });

  it('offers names that start with the query first, then later words, then names that contain it', () => {
    const names = emojiChoices('sk').map(choice => choice.name);
    expect(names.length).toBeLessThanOrEqual(6);
    expect(names[0]).toBe('skull');
    expect(names).toContain('skull_and_crossbones');
    const firstLoose = names.findIndex(name => !name.startsWith('sk'));
    if (firstLoose >= 0) expect(names.slice(firstLoose).every(name => !name.startsWith('sk'))).toBe(true);
    expect(emojiChoices('skull')[0]).toEqual({ emoji: '💀', name: 'skull' });
  });

  it('offers nothing for writing that fits no emoji, so the menu stays shut', () => {
    expect(emojiChoices('qqzx')).toEqual([]);
    expect(emojiChoices('s')).toEqual([]);
  });

  it('lists each emoji once', () => {
    const emojis = emojiChoices('thumbs').map(choice => choice.emoji);
    expect(new Set(emojis).size).toBe(emojis.length);
  });

  it('replaces the typed query with the picked emoji and puts the cursor after it', () => {
    const text = 'lol :sk and more';
    const query = shortcodeQueryAt(text, 7)!;
    expect(insertEmoji(text, 7, query, '💀')).toEqual({ text: 'lol 💀 and more', cursor: 'lol 💀'.length });
  });
});
