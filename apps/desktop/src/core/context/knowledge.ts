import { z } from 'zod';
import type { Run, Team, Worker } from '../../shared/contracts';
import { isMemory, Knowledge, KnowledgeInput, KnowledgeProposal, MEMORY_CAP, RememberArgs, type KnowledgeScope } from '../../shared/knowledge';
import { turnMessageId } from '../../shared/message-interactions';
import { Store, id, now } from '../storage/database';
import { fingerprint } from '../tools/sources';

const contentHash = (item: Pick<Knowledge, 'title' | 'content' | 'tags'>) => fingerprint(JSON.stringify({ title: item.title, content: item.content, tags: item.tags }));
const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
const sameScope = (a: KnowledgeScope, b: KnowledgeScope) => a.type === b.type && (a.type === 'workspace' || a.id === (b as { id: string }).id);

/** Case, punctuation and spacing do not make a memory new: "Prefers short replies." and "prefers short replies" are one. */
export function normalizedMemoryText(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** Exact after normalisation, or the same words with a couple swapped or dropped (nine in ten shared). */
export function similarMemoryText(first: string, second: string) {
  const left = normalizedMemoryText(first);
  const right = normalizedMemoryText(second);
  if (left === right) return true;
  const leftWords = new Set(left.split(' '));
  const rightWords = new Set(right.split(' '));
  if (leftWords.size < 4 || rightWords.size < 4) return false;
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared += 1;
  const union = leftWords.size + rightWords.size - shared;
  return shared / union >= 0.9;
}
/** The title the Library shows for a memory: its own first line, cut at the title limit. */
const memoryTitle = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 200);

/** `scope` says who will use the line, so the chat can tell the person where it was kept (COD-259). */
export type RememberOutcome = { memoryId: string; status: 'approved' | 'proposed'; merged: boolean; scope: KnowledgeScope['type'] };

export class KnowledgeBase {
  constructor(private store: Store) {}
  list(): Knowledge[] { return this.store.all<Knowledge>('knowledge'); }
  /** A user-authored save is itself the review: it creates a new approved revision. */
  save(raw: unknown): Knowledge {
    const input = KnowledgeInput.parse(raw);
    this.assertScope(input.scope);
    const previous = input.id ? this.store.get<Knowledge>('knowledge', input.id) : undefined;
    // A memory edited through the note editor stays a memory; the kind is the row's, never the form's.
    const kind = previous?.kind ?? input.kind;
    const item: Knowledge = { ...input, ...(kind ? { kind } : {}), id: previous?.id ?? id(), revision: (previous?.revision ?? 0) + 1, status: 'approved', hash: contentHash(input), provenance: previous?.provenance ?? { kind: 'user' }, createdAt: now() };
    this.store.transaction(() => this.write(item));
    return item;
  }
  review(itemId: string, revision: number, decision: 'approve' | 'archive') {
    const current = this.store.get<Knowledge>('knowledge', itemId);
    if (current.revision !== revision) throw new Error('Knowledge đã có revision mới. Mở lại để duyệt đúng nội dung.');
    if (decision === 'approve' && current.status !== 'proposed') throw new Error('Chỉ duyệt được đề xuất đang chờ.');
    if (decision === 'archive' && current.status === 'archived') throw new Error('Knowledge đã được lưu trữ.');
    this.assertScope(current.scope);
    // Revision rows stay immutable: a decision is a new revision with the reviewed content unchanged.
    const item: Knowledge = { ...current, revision: current.revision + 1, status: decision === 'approve' ? 'approved' : 'archived', createdAt: now() };
    this.store.transaction(() => {
      this.write(item);
      if (isMemory(item) && item.status === 'approved') this.evictMemories(item.scope);
    });
  }
  search(query: string): Knowledge[] {
    const terms = (query.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
    if (!terms.length) return this.list();
    // Each term is quoted, so FTS5 operators typed by the user are treated as text.
    const match = terms.map(term => `"${term}"*`).join(' ');
    const ids = this.store.db.prepare('SELECT id FROM knowledge_search WHERE knowledge_search MATCH ? ORDER BY rank LIMIT 200').all(match).map(row => String(row.id));
    return ids.map(itemId => this.store.get<Knowledge>('knowledge', itemId));
  }
  /** Approved notes visible to one worker, in its team when running for a team. Other teams never leak in. */
  candidates(workerId: string, teamId?: string): Knowledge[] {
    return this.visibleTo(workerId, teamId).filter(item => !isMemory(item));
  }
  /** Active memories the same worker, team and workspace hold; the compiler orders and bounds them. */
  memoryCandidates(workerId: string, teamId?: string): Knowledge[] {
    return this.visibleTo(workerId, teamId).filter(isMemory);
  }
  private visibleTo(workerId: string, teamId?: string): Knowledge[] {
    return this.list().filter(item => item.status === 'approved' && (item.scope.type === 'workspace' || (item.scope.type === 'worker' && item.scope.id === workerId) || (item.scope.type === 'team' && item.scope.id === teamId)));
  }
  /** Every memory row, newest revision first. */
  memories(): Knowledge[] {
    return this.list().filter(isMemory).sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  }
  /**
   * Remembers one line for a run, active at once unless the run has read something nobody vetted (web pages, files,
   * other workers' messages), in which case it waits for review like a proposed note (COD-161). A line the scope
   * already holds is merged: the existing memory gets a new revision pointing at this chat, so it counts as newest
   * and keeps both chats as its origin. Caller owns the transaction.
   */
  remember(run: Run, raw: unknown, options: { untrusted: boolean }): RememberOutcome {
    const input = RememberArgs.parse(raw);
    const scope = this.memoryScope(run, input.scope ?? 'worker');
    const provenance: Knowledge['provenance'] = { kind: 'turn', taskId: run.taskId, runId: run.id, messageId: turnMessageId(run.taskId, run.snapshot.inputRevision ?? 0), workerId: run.snapshot.worker.id };
    const status = options.untrusted ? 'proposed' : 'approved';
    const existing = this.memories().filter(item => item.status !== 'archived' && sameScope(item.scope, scope));
    const duplicate = existing.find(item => similarMemoryText(item.content, input.text));
    if (duplicate) {
      // An approved memory restated by a tainted run stays approved: its text does not change.
      const mergedStatus = duplicate.status === 'approved' ? 'approved' : status;
      this.write({ ...duplicate, revision: duplicate.revision + 1, status: mergedStatus, provenance, createdAt: now() });
      return { memoryId: duplicate.id, status: mergedStatus, merged: true, scope: scope.type };
    }
    const item: Knowledge = { kind: 'memory', id: id(), revision: 1, title: memoryTitle(input.text), content: input.text, tags: [], pinned: false, scope, status, hash: contentHash({ title: memoryTitle(input.text), content: input.text, tags: [] }), provenance, createdAt: now() };
    this.write(item);
    if (status === 'approved') this.evictMemories(scope);
    return { memoryId: item.id, status, merged: false, scope: scope.type };
  }
  /** The person's correction of a memory: new text or a pin, saved as a new approved revision. */
  updateMemory(memoryId: string, patch: { text?: string; pinned?: boolean }): Knowledge {
    const current = this.memory(memoryId);
    const text = (patch.text ?? current.content).replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Ghi nhớ không được để trống.');
    const item: Knowledge = { ...current, revision: current.revision + 1, title: memoryTitle(text), content: text, pinned: patch.pinned ?? current.pinned, status: 'approved', hash: contentHash({ title: memoryTitle(text), content: text, tags: current.tags }), createdAt: now() };
    this.store.transaction(() => {
      this.write(item);
      this.evictMemories(item.scope);
    });
    return item;
  }
  /** A memory the person deletes is gone, revisions and all; a note is archived instead, since notes are reviewed work. */
  deleteMemory(memoryId: string) {
    this.memory(memoryId);
    this.store.transaction(() => this.deleteRows(memoryId));
  }
  /**
   * Memories learned only in this chat: every revision points at it, or at a chat that is already gone. One also
   * merged from another chat that still exists stays with that chat.
   */
  memoriesOnlyFrom(taskId: string): Knowledge[] {
    const liveTaskIds = new Set(this.store.all<{ id: string; deletedAt?: string }>('tasks').filter(task => !task.deletedAt).map(task => task.id));
    return this.memories().filter(item => {
      const origins = this.store.db.prepare('SELECT data FROM knowledge_revisions WHERE id=?').all(item.id).map(row => (JSON.parse(String(row.data)) as Knowledge).provenance);
      return origins.length > 0 && origins.every(origin => origin.kind === 'turn' && (origin.taskId === taskId || !liveTaskIds.has(origin.taskId)));
    });
  }
  deleteRows(itemId: string) {
    for (const table of ['knowledge_search', 'knowledge_revisions', 'knowledge']) this.store.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(itemId);
  }
  /** Stores model suggestions for review. Caller owns the transaction. */
  propose(run: Run, artifactId: string, proposals: z.infer<typeof KnowledgeProposal>[]) {
    const scope: KnowledgeScope = run.snapshot.team ? { type: 'team', id: run.snapshot.team.id } : { type: 'worker', id: run.snapshot.worker.id };
    const existing = this.list().filter(item => item.status !== 'archived' && !isMemory(item) && sameScope(item.scope, scope));
    for (const proposal of proposals.slice(0, 3)) {
      const parsed = KnowledgeInput.safeParse({ title: proposal.title, content: proposal.content, tags: proposal.tags, pinned: false, scope });
      if (!parsed.success || existing.some(item => sameText(item.content, parsed.data.content))) continue;
      const item: Knowledge = { ...parsed.data, id: id(), revision: 1, status: 'proposed', hash: contentHash(parsed.data), provenance: { kind: 'run', taskId: run.taskId, runId: run.id, artifactId, workerId: run.snapshot.worker.id }, createdAt: now() };
      this.write(item); existing.push(item);
    }
  }
  /** Imported template notes come from outside this workspace, so they wait for local review. Caller owns the transaction. */
  importProposed(teamId: string, items: { title: string; content: string; tags: string[]; pinned: boolean }[]) {
    for (const entry of items) {
      const input = KnowledgeInput.parse({ ...entry, scope: { type: 'team', id: teamId } });
      this.write({ ...input, id: id(), revision: 1, status: 'proposed', hash: contentHash(input), provenance: { kind: 'template' }, createdAt: now() });
    }
  }
  write(item: Knowledge) {
    Knowledge.parse(item);
    this.store.db.prepare('INSERT INTO knowledge_revisions VALUES(?,?,?)').run(item.id, item.revision, JSON.stringify(item));
    this.store.put('knowledge', item);
    this.index(item);
  }
  index(item: Knowledge) {
    this.store.db.prepare('DELETE FROM knowledge_search WHERE id=?').run(item.id);
    if (item.status !== 'archived') this.store.db.prepare('INSERT INTO knowledge_search VALUES(?,?,?,?)').run(item.id, item.title, item.content, item.tags.join(' '));
  }
  /** Past the cap, the oldest unpinned memories of a scope are archived (a revision, not a deletion); pinned ones stay. */
  private evictMemories(scope: KnowledgeScope) {
    const active = this.memories().filter(item => item.status === 'approved' && sameScope(item.scope, scope));
    let excess = active.length - MEMORY_CAP;
    if (excess <= 0) return;
    const oldestFirst = active.filter(item => !item.pinned).sort((first, second) => first.createdAt.localeCompare(second.createdAt));
    for (const item of oldestFirst) {
      if (excess <= 0) break;
      this.write({ ...item, revision: item.revision + 1, status: 'archived', createdAt: now() });
      excess -= 1;
    }
  }
  private memory(memoryId: string): Knowledge {
    const item = this.store.get<Knowledge>('knowledge', memoryId);
    if (!isMemory(item)) throw new Error('Mục này không phải ghi nhớ.');
    return item;
  }
  /** Where a remembered line lives: this worker unless the run asked for its team or the whole workspace. */
  private memoryScope(run: Run, name: 'worker' | 'team' | 'workspace'): KnowledgeScope {
    if (name === 'workspace') return { type: 'workspace' };
    if (name === 'team') {
      if (!run.snapshot.team) throw new Error('Lượt chạy này không thuộc hội nào; ghi nhớ cho Tí hoặc toàn workspace.');
      return { type: 'team', id: run.snapshot.team.id };
    }
    return { type: 'worker', id: run.snapshot.worker.id };
  }
  private assertScope(scope: KnowledgeScope) {
    if (scope.type === 'team') this.store.get<Team>('teams', scope.id);
    if (scope.type === 'worker') this.store.get<Worker>('workers', scope.id);
  }
}
