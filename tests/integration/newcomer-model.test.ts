import { describe, expect, it } from 'vitest';
import { emptyConnections, type Task, type Team, type Worker } from '../../apps/desktop/src/shared/contracts';
import type { ModelEntry } from '../../apps/desktop/src/shared/models';
import type { HarnessInfo } from '../../apps/desktop/src/shared/harness';
import type { CustomConnection } from '../../apps/desktop/src/shared/custom-connections';
import { readiness } from '../../apps/desktop/src/renderer/components/providers';
import { workerProviderOptions } from '../../apps/desktop/src/renderer/components/WorkerDialog';
import { modelIdRequired, startingModelId } from '../../apps/desktop/src/renderer/components/workerModel';
import { chatSettingsTarget, connectModelStep, demoWorkerToConnect } from '../../apps/desktop/src/renderer/chatSettings';

/**
 * COD-293, dogfood round 7 as a first-time AI user: the chat header's Edit opened the task form instead of the
 * orglet's settings, the Demo answer pointed at a "local harness" with no button, and a custom connection offering
 * exactly one model left the Model ID empty so Save refused.
 */

const model = (provider: ModelEntry['provider'], id: string): ModelEntry => ({ provider, id, source: 'native' });
const worker = (id: string, provider: Worker['provider'] = 'demo') => ({ id, name: id, provider }) as Worker;
const team = (id: string, synthesizerId: string) => ({ id, name: id, synthesizerId }) as Team;
const chat = (fields: Partial<Pick<Task, 'teamId' | 'assignees' | 'workerId'>>) => ({ workerId: 'researcher', ...fields }) as Pick<Task, 'teamId' | 'assignees' | 'workerId'>;
const fakeId = '11111111-1111-4111-8111-111111111111';
const fakeProvider = `custom:${fakeId}` as const;
const fake: CustomConnection = { id: fakeId, name: 'Fake', baseUrl: 'http://127.0.0.1:48210/v1' };
const harness = (id: HarnessInfo['id'], signedIn: boolean): HarnessInfo => ({
  id, name: id, executable: `${id}.exe`, version: '1.0.0', auth: signedIn ? 'logged_in' : 'logged_out',
  status: signedIn ? 'signed_in' : 'detected', authDetail: '', loginCommand: `${id} login`, loginCommands: [],
  runnable: true, accountId: 'system', accounts: [],
});

describe('the model ID a connection starts on', () => {
  it('takes the only model a custom connection offers, or the first of several', () => {
    expect(startingModelId(fakeProvider, [model(fakeProvider, 'fake-1')])).toBe('fake-1');
    expect(startingModelId(fakeProvider, [model(fakeProvider, 'qwen3'), model(fakeProvider, 'llama3')])).toBe('qwen3');
  });

  it('stays empty when the list has nothing to offer, so the person types one', () => {
    expect(startingModelId(fakeProvider, [])).toBe('');
  });

  it('skips a model Orglet cannot call on a plan with no default', () => {
    const models = [model('opencode-go', 'unsupported-one'), model('opencode-go', 'supported-one')];
    expect(startingModelId('opencode-go', models, modelId => modelId === 'supported-one')).toBe('supported-one');
  });

  it('leaves the field empty where an empty field already runs something', () => {
    // A paid API runs its catalog suggestion, a harness its CLI default.
    expect(startingModelId('openai', [model('openai', 'gpt-5')])).toBe('');
    expect(startingModelId('codex', [model('codex', 'gpt-5-codex')])).toBe('');
    expect(startingModelId('demo', [])).toBe('');
  });

  it('picks an installed Ollama model only when the suggestion is not installed', () => {
    expect(startingModelId('ollama', [model('ollama', 'qwen3:8b'), model('ollama', 'llama3.2:latest')])).toBe('');
    expect(startingModelId('ollama', [model('ollama', 'qwen3:8b')])).toBe('qwen3:8b');
  });

  it('marks the field required only where the orglet cannot be saved without it', () => {
    expect(modelIdRequired(fakeProvider)).toBe(true);
    expect(modelIdRequired('opencode-zen')).toBe(true);
    expect(modelIdRequired('openai')).toBe(false);
    expect(modelIdRequired('claude-code')).toBe(false);
  });
});

describe('the settings the chat header opens', () => {
  const researcher = worker('researcher');
  const writer = worker('writer');
  const crew = team('crew', 'researcher');
  const workspace = { workers: [researcher, writer], teams: [crew] };

  it('opens the orglet from its main chat or a side thread, and the one orglet a chat was handed to', () => {
    expect(chatSettingsTarget({ task: chat({}) }, workspace)).toEqual({ kind: 'worker', worker: researcher });
    expect(chatSettingsTarget({ task: chat({ assignees: ['writer'] }) }, workspace)).toEqual({ kind: 'worker', worker: writer });
  });

  it('opens the crew from a crew chat, and nobody\'s from a chat several orglets share', () => {
    expect(chatSettingsTarget({ task: chat({ teamId: 'crew' }) }, workspace)).toEqual({ kind: 'team', team: crew });
    expect(chatSettingsTarget({ task: chat({ assignees: ['researcher', 'writer'] }) }, workspace)).toBeUndefined();
    expect(chatSettingsTarget({ task: chat({ assignees: 'all' }) }, workspace)).toBeUndefined();
  });

  it('reads an empty chat from what is being opened', () => {
    expect(chatSettingsTarget({ worker: researcher }, workspace)).toEqual({ kind: 'worker', worker: researcher });
    expect(chatSettingsTarget({ worker: researcher, team: crew }, workspace)).toEqual({ kind: 'team', team: crew });
    expect(chatSettingsTarget({ worker: researcher, group: true }, workspace)).toBeUndefined();
  });

  it('offers nothing for an orglet or crew that is gone', () => {
    expect(chatSettingsTarget({ task: chat({ workerId: 'deleted' }) }, workspace)).toBeUndefined();
    expect(chatSettingsTarget({ task: chat({ teamId: 'deleted' }) }, workspace)).toBeUndefined();
  });
});

describe('Connect a model', () => {
  it('sets up the crew\'s lead first when it is on Demo, otherwise the first orglet on Demo', () => {
    const lead = worker('lead');
    const member = worker('member');
    expect(demoWorkerToConnect([member, lead], team('crew', 'lead'))).toBe(lead);
    expect(demoWorkerToConnect([member, worker('lead', 'openai')], team('crew', 'lead'))).toBe(member);
    expect(demoWorkerToConnect([worker('real', 'codex')])).toBeUndefined();
  });

  it('opens Settings to add a connection when only Demo can run', () => {
    const harnesses = [harness('codex', false)];
    expect(connectModelStep(workerProviderOptions(readiness(emptyConnections(), harnesses), harnesses, []))).toBe('settings');
  });

  it('opens the orglet\'s settings once a connection can run: a custom connection, a signed-in harness or a key', () => {
    expect(connectModelStep(workerProviderOptions(readiness(emptyConnections(), [], [fake]), [], [fake]))).toBe('orglet');
    const codexReady = [harness('codex', true)];
    expect(connectModelStep(workerProviderOptions(readiness(emptyConnections(), codexReady), codexReady, []))).toBe('orglet');
    const withKey = { ...emptyConnections(), openai: true };
    expect(connectModelStep(workerProviderOptions(readiness(withKey, []), [], []))).toBe('orglet');
  });
});
