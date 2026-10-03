import { isDeepStrictEqual } from 'node:util';
import type { Skill, Worker } from '../../shared/contracts';
import { seedSkill, seedWorker, type Store } from './database';

export type FactorySeed = { workerId: string; skillId: string };

/**
 * A new computer starts with a Researcher and its skill. This names them while nobody has touched them: no chat,
 * crew, schedule, memory, edit, or setting that mentions them (COD-281). Anything else means the computer holds data
 * of its own.
 */
export function untouchedSeed(store: Store): FactorySeed | undefined {
  const workers = store.all<Worker>('workers');
  const skills = store.all<Skill>('skills');
  if (workers.length !== 1 || skills.length !== 1) return undefined;
  for (const table of ['teams', 'tasks', 'routines', 'knowledge']) {
    if (store.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) return undefined;
  }
  const [worker] = workers;
  const [skill] = skills;
  if (!isDeepStrictEqual(worker, seedWorker(worker.id, skill.id)) || !isDeepStrictEqual(skill, seedSkill(skill.id))) return undefined;
  if (Number(store.db.prepare('SELECT COUNT(*) AS count FROM revisions').get()!.count) !== 2) return undefined;
  const mentioned = store.db.prepare('SELECT COUNT(*) AS count FROM settings WHERE instr(data, ?) > 0 OR instr(data, ?) > 0').get(worker.id, skill.id)!;
  if (Number(mentioned.count) > 0) return undefined;
  return { workerId: worker.id, skillId: skill.id };
}

/** Removes the untouched seed, so incoming orglets do not sit beside a second Researcher. */
export function removeSeed(store: Store, seed: FactorySeed) {
  store.sync.discardFactorySeed(seed.workerId, seed.skillId);
  store.db.prepare('DELETE FROM workers WHERE id=?').run(seed.workerId);
  store.db.prepare('DELETE FROM skills WHERE id=?').run(seed.skillId);
  store.db.prepare('DELETE FROM revisions WHERE entity_id IN (?,?)').run(seed.workerId, seed.skillId);
}
