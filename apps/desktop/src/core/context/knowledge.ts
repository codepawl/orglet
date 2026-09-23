import { z } from 'zod';
import type { Run, Team, Worker } from '../../shared/contracts';
import { Knowledge, KnowledgeInput, KnowledgeProposal, type KnowledgeScope } from '../../shared/knowledge';
import { Store, id, now } from '../storage/database';
import { fingerprint } from '../tools/sources';

const contentHash = (item: Pick<Knowledge, 'title' | 'content' | 'tags'>) => fingerprint(JSON.stringify({ title: item.title, content: item.content, tags: item.tags }));
const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
const sameScope = (a: KnowledgeScope, b: KnowledgeScope) => a.type === b.type && (a.type === 'workspace' || a.id === (b as { id: string }).id);

export class KnowledgeBase {
  constructor(private store: Store) {}
  list(): Knowledge[] { return this.store.all<Knowledge>('knowledge'); }
  /** A user-authored save is itself the review: it creates a new approved revision. */
  save(raw: unknown): Knowledge {
    const input = KnowledgeInput.parse(raw);
    this.assertScope(input.scope);
    const previous = input.id ? this.store.get<Knowledge>('knowledge', input.id) : undefined;
    const item: Knowledge = { ...input, id: previous?.id ?? id(), revision: (previous?.revision ?? 0) + 1, status: 'approved', hash: contentHash(input), provenance: previous?.provenance ?? { kind: 'user' }, createdAt: now() };
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
    this.store.transaction(() => this.write(item));
  }
  search(query: string): Knowledge[] {
    const terms = (query.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
    if (!terms.length) return this.list();
    // Each term is quoted, so FTS5 operators typed by the user are treated as text.
    const match = terms.map(term => `"${term}"*`).join(' ');
    const ids = this.store.db.prepare('SELECT id FROM knowledge_search WHERE knowledge_search MATCH ? ORDER BY rank LIMIT 200').all(match).map(row => String(row.id));
    return ids.map(itemId => this.store.get<Knowledge>('knowledge', itemId));
  }
  /** Approved items visible to one worker, in its team when running for a team. Other teams never leak in. */
  candidates(workerId: string, teamId?: string): Knowledge[] {
    return this.list().filter(item => item.status === 'approved' && (item.scope.type === 'workspace' || (item.scope.type === 'worker' && item.scope.id === workerId) || (item.scope.type === 'team' && item.scope.id === teamId)));
  }
  /** Stores model suggestions for review. Caller owns the transaction. */
  propose(run: Run, artifactId: string, proposals: z.infer<typeof KnowledgeProposal>[]) {
    const scope: KnowledgeScope = run.snapshot.team ? { type: 'team', id: run.snapshot.team.id } : { type: 'worker', id: run.snapshot.worker.id };
    const existing = this.list().filter(item => item.status !== 'archived' && sameScope(item.scope, scope));
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
  private assertScope(scope: KnowledgeScope) {
    if (scope.type === 'team') this.store.get<Team>('teams', scope.id);
    if (scope.type === 'worker') this.store.get<Worker>('workers', scope.id);
  }
}
