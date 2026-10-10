import { AppRefusal } from './chat-client';
import { callStartingApp } from './client';
import type { ElevationScope } from '../shared/terminal-access';
import type { HeldBody, HeldValue, PairFinishValue, PairStartValue, WaitingCard, WaitingValue } from './held-protocol';
import type { CliElevatedBody, CliRequestBody, ShowValue } from './protocol';

/**
 * The terminal's end of pairing and the held operations (docs/cli-held-actions-design.md). The elevation key lives in
 * this object's memory and nowhere else: it is never written to a file, an environment variable or the output, and a
 * one-shot command's object is gone when the command exits.
 */

export type WaitingTarget = { to?: string; chat?: string };

export type HeldClient = {
  /** Whether this process holds a key that has not been refused yet. */
  unlocked: () => boolean;
  waiting: (target: WaitingTarget) => Promise<WaitingCard[]>;
  startPairing: (scope: ElevationScope, operation?: HeldBody) => Promise<PairStartValue>;
  /** A match keeps the key in memory; a wrong code is an `AppRefusal` with the code `invalid` and tries left. */
  finishPairing: (pairingId: string, code: string) => Promise<ElevationScope>;
  cancelPairing: (pairingId: string) => Promise<void>;
  /** Ends the elevation in the app and forgets the key here. */
  lock: () => Promise<void>;
  /** Forgets the key without asking the app: the session is over. */
  forget: () => void;
  act: (body: HeldBody) => Promise<HeldValue>;
  journal: () => Promise<ShowValue>;
};

export function createHeldClient(userData: string, executable: string | undefined): HeldClient {
  let key: string | undefined;

  async function send<Value>(body: CliRequestBody, withKey = false): Promise<Value> {
    const line: CliElevatedBody = withKey && key ? { ...body, elevation: key } : body;
    const response = await callStartingApp(userData, line, executable);
    if (!response.ok) {
      // A key the app refused is dead; keeping it would only repeat the refusal.
      if (response.code === 'locked') key = undefined;
      throw new AppRefusal(response.error, response.code);
    }
    return response.value as Value;
  }

  return {
    unlocked: () => key !== undefined,
    waiting: async target => (await send<WaitingValue>({ op: 'waiting', ...target })).cards,
    startPairing: (scope, operation) => send<PairStartValue>({ op: 'pair-start', scope, ...(operation ? { operation } : {}) }),
    finishPairing: async (pairingId, code) => {
      const finished = await send<PairFinishValue>({ op: 'pair-finish', pairingId, code });
      key = finished.key;
      return finished.scope;
    },
    cancelPairing: async pairingId => {
      await send({ op: 'pair-cancel', pairingId });
    },
    lock: async () => {
      key = undefined;
      await send({ op: 'elevation-end' });
    },
    forget: () => {
      key = undefined;
    },
    act: body => send<HeldValue>({ op: 'held', request: body }, true),
    journal: () => send<ShowValue>({ op: 'show', what: 'terminal', refresh: false }),
  };
}
