import { describe, expect, it } from 'vitest';
import { emptyConnections } from '../../apps/desktop/src/shared/contracts';
import type { HarnessInfo } from '../../apps/desktop/src/shared/harness';
import { readiness, readyFirst } from '../../apps/desktop/src/renderer/components/providers';
import { defaultWorkerProvider, workerProviderOptions } from '../../apps/desktop/src/renderer/components/WorkerDialog';
import { t } from '../../apps/desktop/src/renderer/i18n';

/** A detected harness, signed in or not; only the fields the menu reads matter here. */
const harness = (id: HarnessInfo['id'], signedIn: boolean): HarnessInfo => ({
  id, name: id, executable: `${id}.exe`, version: '1.0.0', auth: signedIn ? 'logged_in' : 'logged_out',
  status: signedIn ? 'signed_in' : 'detected', authDetail: '', loginCommand: `${id} login`, loginCommands: [],
  runnable: true, accountId: 'system', accounts: [],
});

/**
 * COD-255: on a fresh profile the Model menu listed Demo, then seven greyed API rows, and only then the two
 * harnesses that were signed in and ready. What can run now comes right after Demo; the rest waits at the end.
 */
describe('the Model menu', () => {
  it('lists Demo, then the ready connections under their own group, then everything else under one group', () => {
    const harnesses = [harness('claude-code', true), harness('codex', true), harness('cursor', false)];
    const options = workerProviderOptions(readiness(emptyConnections(), harnesses), harnesses, []);
    expect(options.map(option => option.value)).toEqual([
      'demo', 'claude-code', 'codex',
      'openai', 'anthropic', 'xai', 'openrouter', 'opencode-zen', 'opencode-go', 'ollama', 'cursor', 'gemini',
    ]);
    expect(options.slice(0, 3).map(option => option.group)).toEqual([t('Thử nghiệm'), t('Harness trên máy'), t('Harness trên máy')]);
    expect(new Set(options.slice(3).map(option => option.group))).toEqual(new Set([t('Chưa sẵn sàng')]));
    expect(options.slice(3).every(option => option.dimmed)).toBe(true);
    expect(options.slice(0, 3).some(option => option.dimmed)).toBe(false);
  });

  it('puts an API with a saved key beside the ready harness, both before any row that cannot run', () => {
    const harnesses = [harness('codex', true)];
    const connections = { ...emptyConnections(), anthropic: true };
    const options = workerProviderOptions(readiness(connections, harnesses), harnesses, []);
    expect(options.slice(0, 3).map(option => [option.value, option.group])).toEqual([
      ['demo', t('Thử nghiệm')], ['anthropic', t('API trả phí')], ['codex', t('Harness trên máy')],
    ]);
    expect(options.slice(3).map(option => option.value)).not.toContain('anthropic');
  });

  it('keeps each harness\'s own state mark, ready or not, and drops the per-row badge the group now says', () => {
    const harnesses = [harness('claude-code', false)];
    const options = workerProviderOptions(readiness(emptyConnections(), harnesses), harnesses, []);
    expect(options.find(option => option.value === 'claude-code')?.badge).toBeTruthy();
    expect(options.find(option => option.value === 'openai')?.badge).toBeUndefined();
  });

  it('starts a new orglet on the first connection that can run, in the menu\'s order, and on Demo only when none can', () => {
    // Dogfood, 2026-09-26: Codex was signed in and ready, and a new orglet still started on Demo.
    const codexReady = [harness('claude-code', false), harness('codex', true)];
    expect(defaultWorkerProvider(workerProviderOptions(readiness(emptyConnections(), codexReady), codexReady, []))).toBe('codex');
    // A saved API key sits before the harnesses on the menu, so it comes first here too.
    const withKey = { ...emptyConnections(), anthropic: true };
    expect(defaultWorkerProvider(workerProviderOptions(readiness(withKey, codexReady), codexReady, []))).toBe('anthropic');
    const nothingReady = [harness('codex', false)];
    expect(defaultWorkerProvider(workerProviderOptions(readiness(emptyConnections(), nothingReady), nothingReady, []))).toBe('demo');
    // Before detection has answered, the dialog is given no harnesses, and a harness then is not ready.
    expect(defaultWorkerProvider(workerProviderOptions(readiness(emptyConnections(), []), [], []))).toBe('demo');
  });

  it('keeps the order it was given inside each part', () => {
    const choices = [
      { option: { value: 'a', group: 'one' }, ready: true },
      { option: { value: 'b', group: 'two' }, ready: false },
      { option: { value: 'c', group: 'two' }, ready: true },
      { option: { value: 'd', group: 'one' }, ready: false },
    ];
    expect(readyFirst(choices, 'later')).toEqual([
      { value: 'a', group: 'one' }, { value: 'c', group: 'two' }, { value: 'b', group: 'later' }, { value: 'd', group: 'later' },
    ]);
  });
});
