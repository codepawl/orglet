import { describe, expect, it } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { runInteractive } from '../../apps/desktop/src/cli/interactive';
import { parseSlash, splitWords, SLASH_COMMANDS, SLASH_HELP } from '../../apps/desktop/src/cli/slash';
import type { ChatActionClient, ChatClient } from '../../apps/desktop/src/cli/chat-client';
import type { ListValue } from '../../apps/desktop/src/cli/protocol';

/*
 * Issue 554, phase 3: the chat in the terminal learns spaces and their channels, the marketplace, schedules beyond on
 * and off, editing and deleting memory, and restoring from the archive. A slash command that is a one-shot command is
 * that command, run with the checks and the confirmations it has there.
 */

describe('slash commands for spaces, the marketplace, schedules, memory and the archive', () => {
  it('splits words the way a shell does for quotes', () => {
    expect(splitWords('add "Launch week" --with Writer')).toEqual(['add', 'Launch week', '--with', 'Writer']);
    expect(splitWords("order 'Launch' --name ideas")).toEqual(['order', 'Launch', '--name', 'ideas']);
    expect(splitWords('')).toEqual([]);
    expect(splitWords('a "" b')).toEqual(['a', '', 'b']);
  });

  it('turns /space, /market, /preferences, /update and /show into the one-shot command', () => {
    expect(parseSlash('/space folder "Launch week" --value Work')).toEqual({ kind: 'cli', argv: ['space', 'folder', 'Launch week', '--value', 'Work'] });
    expect(parseSlash('/space')).toMatchObject({ kind: 'usage' });
    expect(parseSlash('/market')).toEqual({ kind: 'cli', argv: ['market'] });
    expect(parseSlash('/market update "Launch space" --confirm 1a2b3c4d')).toEqual({ kind: 'cli', argv: ['market', 'update', 'Launch space', '--confirm', '1a2b3c4d'] });
    expect(parseSlash('/preferences --titles off')).toEqual({ kind: 'cli', argv: ['preferences', '--titles', 'off'] });
    expect(parseSlash('/update')).toEqual({ kind: 'cli', argv: ['update'] });
    expect(parseSlash('/update now')).toEqual({ kind: 'unknown', command: '/update now' });
    expect(parseSlash('/show spend')).toEqual({ kind: 'cli', argv: ['show', 'spend'], withChat: false });
    expect(parseSlash('/show changes')).toEqual({ kind: 'cli', argv: ['show', 'changes'], withChat: true });
    expect(parseSlash('/show')).toMatchObject({ kind: 'usage' });
  });

  it('turns the schedule verbs beyond on and off, and memory edits and deletes, into the one-shot command', () => {
    expect(parseSlash('/schedule on Morning review')).toEqual({ kind: 'schedule', action: 'on', name: 'Morning review' });
    expect(parseSlash('/schedule dismiss "Morning review"')).toEqual({ kind: 'cli', argv: ['schedule', 'dismiss', 'Morning review'] });
    expect(parseSlash('/schedule catch-up "Morning review"')).toEqual({ kind: 'cli', argv: ['schedule', 'catch-up', 'Morning review'] });
    expect(parseSlash('/schedule delete "Morning review" --confirm "Morning review"')).toEqual({ kind: 'cli', argv: ['schedule', 'delete', 'Morning review', '--confirm', 'Morning review'] });
    expect(parseSlash('/schedule add "Review"')).toMatchObject({ kind: 'usage' });
    expect(parseSlash('/schedule nonsense')).toMatchObject({ kind: 'usage' });
    expect(parseSlash('/memory')).toEqual({ kind: 'memory' });
    expect(parseSlash('/memory edit 3f2a --text "Prefers short answers"')).toEqual({ kind: 'cli', argv: ['memory', 'edit', '3f2a', '--text', 'Prefers short answers'] });
    expect(parseSlash('/memory delete 3f2a --confirm 3f2a')).toEqual({ kind: 'cli', argv: ['memory', 'delete', '3f2a', '--confirm', '3f2a'] });
    expect(parseSlash('/memory forget')).toEqual({ kind: 'unknown', command: '/memory forget' });
  });

  it('restores a chat by its id and an orglet or channel by its name', () => {
    expect(parseSlash('/restore #3f2a')).toEqual({ kind: 'cli', argv: ['restore', '--chat', '3f2a'] });
    expect(parseSlash('/restore channel "Launch week"')).toEqual({ kind: 'cli', argv: ['restore', 'channel', 'Launch week'] });
    expect(parseSlash('/restore orglet Writer')).toEqual({ kind: 'cli', argv: ['restore', 'orglet', 'Writer'] });
    expect(parseSlash('/restore')).toMatchObject({ kind: 'usage' });
  });

  it('teaches /chats and /channel about spaces and keeps their older forms as they were', () => {
    expect(parseSlash('/chats')).toEqual({ kind: 'chats', archived: false });
    expect(parseSlash('/chats archived')).toEqual({ kind: 'chats', archived: true });
    expect(parseSlash('/chats --space Launch')).toEqual({ kind: 'chats', archived: false, space: 'Launch' });
    expect(parseSlash('/chats archived --space "Launch week"')).toEqual({ kind: 'chats', archived: true, space: 'Launch week' });
    expect(parseSlash('/chats --space')).toEqual({ kind: 'unknown', command: '/chats --space' });
    expect(parseSlash('/channel Writer, Editor -- Compare these')).toEqual({ kind: 'channel', names: ['Writer', 'Editor'], message: 'Compare these' });
    expect(parseSlash('/channel --space "Launch week" --category Drafts Writer -- Hi')).toEqual({ kind: 'channel', names: ['Writer'], message: 'Hi', space: 'Launch week', category: 'Drafts' });
  });

  it('lists every command it knows in /help', () => {
    const helped = new Set(SLASH_HELP.map(([usage]) => usage.split(' ')[0]));
    for (const command of ['/space', '/market', '/restore', '/preferences', '/show', '/update']) {
      expect(SLASH_COMMANDS).toContain(command);
      expect(helped, command).toContain(command);
    }
  });
});

const list: ListValue = { orglets: [{ name: 'Researcher', provider: 'openai', providerId: 'openai', color: '#4f7fe0' }], crews: [] };

async function notUsed(): Promise<never> {
  throw new Error('Not used in this test.');
}

function session() {
  const calls: string[] = [];
  const chat = { kind: 'worker' as const, id: 'w', name: 'Researcher', color: '#4f7fe0' };
  const actions: ChatActionClient = {
    history: notUsed, reply: notUsed, react: notUsed, forward: notUsed, control: notUsed, answer: notUsed, side: notUsed, bring: notUsed, members: notUsed,
    rename: notUsed, archive: notUsed, schedules: notUsed, spaces: notUsed, enableSchedule: notUsed, runSchedule: notUsed, search: notUsed, running: notUsed,
    memories: notUsed, usage: notUsed, models: notUsed, preferences: notUsed,
    chats: async (archived, space) => {
      calls.push(`chats ${archived} ${space}`);
      return { chats: [] };
    },
    channel: async (names, _message, _signal, place) => {
      calls.push(`channel ${names.join('|')} ${place?.space}/${place?.category}`);
      return { chat, taskId: 'abcd1234-0000-4000-8000-000000000000', waited: true, finished: true, status: 'completed', answers: [{ name: 'Researcher', text: 'Made it.', createdAt: '1' }], errors: [] };
    },
    commandLine: async argv => {
      calls.push(`orglet ${argv.join(' ')}`);
      return argv[0] === 'memory' ? { code: 2, stdout: '', stderr: 'Xóa ghi nhớ là vĩnh viễn.' } : { code: 0, stdout: `ran ${argv[0]}`, stderr: '' };
    },
  };
  const client: ChatClient = {
    list: async () => list,
    send: notUsed,
    read: async () => ({ chat, taskId: 't', status: 'completed', answers: [] }),
    open: async () => ({ chat }),
    actions,
  };
  return { client, calls };
}

async function run(script: string) {
  const input = new PassThrough();
  let transcript = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      transcript += chunk.toString();
      callback();
    },
  });
  const fake = session();
  const running = runInteractive({ input, output, client: fake.client, mode: 'none', version: '9.9.9', terminal: false, to: 'Researcher' });
  input.end(script);
  await running;
  return { transcript, calls: fake.calls };
}

describe('the chat session runs those commands', () => {
  it('prints what the one-shot command printed and adds this chat to /show changes', async () => {
    const result = await run('/space order "Launch" --name ideas --position 1\n/show spend\n/show changes\n/exit\n');
    expect(result.calls[0]).toBe('orglet space order Launch --name ideas --position 1');
    expect(result.calls[1]).toBe('orglet show spend');
    expect(result.calls[2]).toBe('orglet show changes --to Researcher');
    expect(result.transcript).toContain('ran space');
    expect(result.transcript).toContain('ran show');
  });

  it('shows the one-shot command\'s refusal, so a memory delete still needs its confirmation', async () => {
    const result = await run('/memory delete 3f2a\n/exit\n');
    expect(result.calls).toEqual(['orglet memory delete 3f2a']);
    expect(result.transcript).toContain('Xóa ghi nhớ là vĩnh viễn.');
  });

  it('passes the space of /chats and the place of /channel on', async () => {
    const result = await run('/chats --space Launch\n/channel --space Launch --category Drafts Researcher -- Hi\n/exit\n');
    expect(result.calls).toContain('chats false Launch');
    expect(result.calls).toContain('channel Researcher Launch/Drafts');
  });
});
