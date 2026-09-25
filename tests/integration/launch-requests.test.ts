import { describe, expect, it } from 'vitest';
import {
  cleanPrefill,
  LINK_BAD_NAME,
  LINK_NOT_UNDERSTOOD,
  LINK_TEXT_TOO_LONG,
  LINK_TOO_LONG,
  MAX_LINK_LENGTH,
  MAX_PREFILL_LENGTH,
  MAX_SENT_PATHS,
  parseLaunchArguments,
  parseOrgletLink,
  resolveLinkChat,
} from '../../apps/desktop/src/main/launch-requests';
import type { CliChat } from '../../apps/desktop/src/cli/protocol';

// COD-246: what Explorer's Send to menu and orglet:// links pass on the command line, read and checked before the
// window hears of it. A link only opens a chat and fills its message box.

const EXECUTABLE = 'C:\\Users\\An\\AppData\\Local\\Orglet\\app-0.4.0\\Orglet.exe';

describe('Send to arguments', () => {
  it('reads the paths Explorer appends after the shortcut arguments', () => {
    const argv = [EXECUTABLE, '--orglet-send-to', '--', 'C:\\Notes\\a.txt', 'C:\\Notes\\b data.csv'];
    expect(parseLaunchArguments(argv)).toEqual({ kind: 'send-to', paths: ['C:\\Notes\\a.txt', 'C:\\Notes\\b data.csv'] });
  });

  it('ignores switches Chromium adds to a second instance, wherever they land', () => {
    const argv = [EXECUTABLE, '--orglet-send-to', '--original-process-start-time=1340', 'C:\\a.txt', '--allow-file-access-from-files', 'C:\\b.txt'];
    expect(parseLaunchArguments(argv)).toEqual({ kind: 'send-to', paths: ['C:\\a.txt', 'C:\\b.txt'] });
  });

  it('matches the flag in any case, and never reads the executable itself', () => {
    expect(parseLaunchArguments([EXECUTABLE, '--ORGLET-SEND-TO', '--', 'C:\\a.txt'])).toEqual({ kind: 'send-to', paths: ['C:\\a.txt'] });
    expect(parseLaunchArguments(['--orglet-send-to', 'C:\\a.txt'])).toBeUndefined();
  });

  it('is an ordinary start when no files came with the flag', () => {
    expect(parseLaunchArguments([EXECUTABLE, '--orglet-send-to', '--'])).toBeUndefined();
    expect(parseLaunchArguments([EXECUTABLE])).toBeUndefined();
    expect(parseLaunchArguments([EXECUTABLE, '--squirrel-firstrun'])).toBeUndefined();
  });

  it('caps a crafted start with thousands of paths', () => {
    const many = Array.from({ length: MAX_SENT_PATHS + 50 }, (_, index) => `C:\\files\\${index}.txt`);
    const request = parseLaunchArguments([EXECUTABLE, '--orglet-send-to', '--', ...many]);
    expect(request?.kind === 'send-to' && request.paths.length).toBe(MAX_SENT_PATHS);
  });

  it('prefers Send to over a link-looking argument after it', () => {
    const request = parseLaunchArguments([EXECUTABLE, '--orglet-send-to', '--', 'C:\\a.txt', 'orglet://chat/Researcher']);
    expect(request?.kind).toBe('send-to');
  });
});

describe('orglet:// links', () => {
  it('opens a chat by name, as Windows passes it after --', () => {
    expect(parseLaunchArguments([EXECUTABLE, '--', 'orglet://chat/Researcher'])).toEqual({ kind: 'link', link: { action: 'chat', target: 'Researcher' } });
  });

  it('decodes a name with spaces and accents, and a trailing slash does not matter', () => {
    expect(parseOrgletLink('orglet://chat/K%E1%BA%BF%20to%C3%A1n/')).toEqual({ ok: true, link: { action: 'chat', target: 'Kế toán' } });
    expect(parseOrgletLink('ORGLET://CHAT/Review%20crew')).toEqual({ ok: true, link: { action: 'chat', target: 'Review crew' } });
  });

  it('reads a link written without the two slashes', () => {
    expect(parseOrgletLink('orglet:chat/Researcher')).toEqual({ ok: true, link: { action: 'chat', target: 'Researcher' } });
  });

  it('prefills a new message, keeping its line breaks', () => {
    expect(parseOrgletLink('orglet://new?to=Researcher&text=hello')).toEqual({ ok: true, link: { action: 'new', target: 'Researcher', text: 'hello' } });
    expect(parseOrgletLink('orglet://new/?to=Review+crew&text=line%20one%0D%0Aline%20two')).toEqual({ ok: true, link: { action: 'new', target: 'Review crew', text: 'line one\nline two' } });
    expect(parseOrgletLink('orglet://new?to=Researcher')).toEqual({ ok: true, link: { action: 'new', target: 'Researcher', text: '' } });
  });

  it('refuses anything that is not a chat to open or a message to prefill', () => {
    for (const link of ['orglet://settings?theme=dark', 'orglet://delete/Researcher', 'orglet://send?to=Researcher&text=hi', 'orglet://grant/C:/', 'orglet://', 'orglet:', 'orglet://new/Researcher?to=Researcher']) {
      expect(parseOrgletLink(link)).toEqual({ ok: false, message: LINK_NOT_UNDERSTOOD });
    }
  });

  it('refuses malformed links', () => {
    expect(parseOrgletLink('orglet://chat/%E0%A4%A')).toEqual({ ok: false, message: LINK_NOT_UNDERSTOOD });
    expect(parseOrgletLink('orglet://user:secret@chat/Researcher')).toEqual({ ok: false, message: LINK_NOT_UNDERSTOOD });
    expect(parseOrgletLink('orglet://chat:8080/Researcher')).toEqual({ ok: false, message: LINK_NOT_UNDERSTOOD });
    expect(parseOrgletLink('https://example.com/chat/Researcher')).toEqual({ ok: false, message: LINK_NOT_UNDERSTOOD });
  });

  it('needs a name, without hidden characters', () => {
    expect(parseOrgletLink('orglet://chat/')).toEqual({ ok: false, message: LINK_BAD_NAME });
    expect(parseOrgletLink('orglet://new?text=hello')).toEqual({ ok: false, message: LINK_BAD_NAME });
    expect(parseOrgletLink('orglet://new?to=%20%20&text=hello')).toEqual({ ok: false, message: LINK_BAD_NAME });
    expect(parseOrgletLink('orglet://chat/Research%E2%80%AEer')).toEqual({ ok: false, message: LINK_BAD_NAME });
    expect(parseOrgletLink(`orglet://chat/${'a'.repeat(201)}`)).toEqual({ ok: false, message: LINK_BAD_NAME });
  });

  it('refuses an oversized link or prefill instead of cutting it', () => {
    expect(parseOrgletLink(`orglet://new?to=Researcher&text=${'a'.repeat(MAX_LINK_LENGTH)}`)).toEqual({ ok: false, message: LINK_TOO_LONG });
    expect(parseOrgletLink(`orglet://new?to=Researcher&text=${'a'.repeat(MAX_PREFILL_LENGTH + 1)}`)).toEqual({ ok: false, message: LINK_TEXT_TOO_LONG });
    const longest = parseOrgletLink(`orglet://new?to=Researcher&text=${'a'.repeat(MAX_PREFILL_LENGTH)}`);
    expect(longest.ok && longest.link.action === 'new' && longest.link.text.length).toBe(MAX_PREFILL_LENGTH);
  });

  it('takes control and direction-changing characters out of the prefill', () => {
    expect(cleanPrefill('a\u0000b\u202Ec\u2066d\te\r\nf')).toBe('abcd\te\nf');
  });

  it('turns a refused link into a notice, not an error', () => {
    expect(parseLaunchArguments([EXECUTABLE, '--', 'orglet://settings'])).toEqual({ kind: 'refused', message: LINK_NOT_UNDERSTOOD });
  });
});

describe('the chat a link names', () => {
  const chats: CliChat[] = [
    { kind: 'worker', id: 'w-researcher', name: 'Researcher' },
    { kind: 'worker', id: 'w-reviewer', name: 'Reviewer' },
    { kind: 'team', id: 't-review', name: 'Review crew' },
  ];

  it('finds an id first, then a name the way orglet --to does', () => {
    expect(resolveLinkChat('t-review', chats)).toEqual({ ok: true, chat: chats[2] });
    expect(resolveLinkChat('researcher', chats)).toEqual({ ok: true, chat: chats[0] });
    expect(resolveLinkChat('Review c', chats)).toEqual({ ok: true, chat: chats[2] });
  });

  it('gives a calm message for an unknown or ambiguous name', () => {
    expect(resolveLinkChat('Accountant', chats)).toEqual({ ok: false, message: 'Không có Tí hay hội nào tên "Accountant". Có: Researcher, Reviewer, Review crew.' });
    expect(resolveLinkChat('Re', chats)).toEqual({ ok: false, message: '"Re" khớp với nhiều tên: Researcher, Reviewer, Review crew. Gõ tên đầy đủ hơn.' });
    expect(resolveLinkChat('Researcher', [])).toEqual({ ok: false, message: 'Chưa có Tí hay hội nào.' });
  });
});
