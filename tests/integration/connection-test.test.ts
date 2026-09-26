import { expect, it } from 'vitest';
import { connectionTestOutcome } from '../../apps/desktop/src/renderer/customConnections';
import type { ModelEntry } from '../../apps/desktop/src/shared/models';

const listed = (count: number): ModelEntry[] => Array.from({ length: count }, (_, index) => ({ provider: 'openai', id: `model-${index}`, source: 'native' }));

// COD-292: a custom connection's Test asks its server for the model list again and says what came back.
it('says how many models a custom connection offers, with the words for one', () => {
  expect(connectionTestOutcome('LM Studio', { models: listed(3) })).toEqual({ ok: true, text: 'LM Studio answered · 3 models' });
  expect(connectionTestOutcome('LM Studio', { models: listed(1) })).toEqual({ ok: true, text: 'LM Studio answered · 1 model' });
  expect(connectionTestOutcome('LM Studio', { models: [] })).toEqual({ ok: true, text: 'LM Studio answered but offers no models yet.' });
});

it('fails the test with the server\'s own reason when the list could not be read', () => {
  const outcome = connectionTestOutcome('LM Studio', { models: listed(2), error: 'connect ECONNREFUSED 127.0.0.1:1234' });
  expect(outcome).toEqual({ ok: false, text: 'LM Studio did not answer: connect ECONNREFUSED 127.0.0.1:1234' });
});
