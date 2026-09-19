import { expect, it } from 'vitest';
import { identitySection } from '../../apps/desktop/src/core/context/compiler';
import type { Skill, Team, Worker } from '../../apps/desktop/src/shared/contracts';

const skill: Skill = { id: 'skill-1', revision: 1, name: 'Contract review', content: 'Read the contract and flag risky clauses.' };

function worker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: 'worker-1',
    revision: 1,
    name: 'Mai',
    instructions: 'Answer in the user language.',
    provider: 'demo',
    skillId: skill.id,
    ...overrides,
  } as Worker;
}

const team: Team = {
  id: 'team-1',
  revision: 1,
  name: 'Contract desk',
  instructions: 'Check contracts together.',
  memberIds: ['worker-1', 'worker-2'],
  synthesizerId: 'worker-3',
  workflow: 'parallel',
  monthlyBudgetMicros: 1_000_000,
};

it('tells a worker who it is, what it is for and which skill it follows', () => {
  const text = identitySection({ worker: worker({ description: 'Reads contracts and flags risk' }), skill });
  expect(text).toContain('You are Mai, an AI worker in the user\'s Orglet workspace, not a general chatbot.');
  expect(text).toContain('You were hired for this: Reads contracts and flags risk');
  expect(text).toContain('Your skill sheet is "Contract review"');
  expect(text).toContain('speak as yourself');
});

it('leaves out the role line when the worker has no description', () => {
  expect(identitySection({ worker: worker(), skill })).not.toContain('hired for this');
});

it('says a one-to-one chat has no visible colleagues, instead of leaving the worker guessing', () => {
  const text = identitySection({ worker: worker(), skill });
  expect(text).toContain('This is your own chat with the user.');
  expect(text).toContain('you cannot see them or their chats');
});

it('names the team, the worker\'s part in it and the colleagues', () => {
  const colleagues = [
    { id: 'worker-1', name: 'Mai' },
    { id: 'worker-2', name: 'Khoa', description: 'Checks numbers' },
    { id: 'worker-3', name: 'Linh' },
  ];
  const member = identitySection({ worker: worker(), skill, team, colleagues, stage: 'member' });
  expect(member).toContain('You are on the team "Contract desk", where you answer your part of the work.');
  expect(member).toContain('Working with you: Khoa (Checks numbers), Linh.');
  expect(member).not.toContain('Mai (');
  expect(member).toContain('This turn you answer only the brief the team gave you.');

  const synthesizer = identitySection({ worker: worker({ id: 'worker-3', name: 'Linh' }), skill, team, colleagues, stage: 'synthesis' });
  expect(synthesizer).toContain('where you write the team\'s final answer');
  expect(synthesizer).toContain('This turn you combine your teammates');
});

it('tells a group-chat worker not to repeat what the others already said', () => {
  const text = identitySection({ worker: worker(), skill, colleagues: [{ id: 'worker-2', name: 'Khoa' }], stage: 'group' });
  expect(text).toContain('add what is missing and do not repeat them');
  expect(text).not.toContain('on the team');
});
