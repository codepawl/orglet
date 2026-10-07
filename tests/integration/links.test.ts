import { expect, it } from 'vitest';
import { linkHost, openableUrl } from '../../apps/desktop/src/shared/links';

it('opens only web and mail addresses, never files, scripts, other schemes or a hidden sign-in', () => {
  expect(openableUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  expect(openableUrl('http://localhost:3000/')).toBe('http://localhost:3000/');
  expect(openableUrl('mailto:team@example.com')).toBe('mailto:team@example.com');
  for (const address of ['file:///C:/Windows', 'javascript:alert(1)', 'orglet://chat/1', 'ms-settings:privacy', 'https://user:secret@example.com/', 'https://bank.example@evil.example/', 'not a url', `https://example.com/${'a'.repeat(2100)}`]) {
    expect(openableUrl(address)).toBeUndefined();
  }
});

it('names a link by its site', () => {
  expect(linkHost('https://www.example.com/page')).toBe('example.com');
  expect(linkHost('mailto:team@example.com')).toBe('team@example.com');
});
