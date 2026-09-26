import type { Artifact, Run, Task, Worker } from '../../shared/contracts';
import { liveWorkerTask } from '../../shared/live-task';
import { mcpCallGranted, type McpGrant } from '../../shared/mcp';
import { canStartSideThread, ChatQuote, MAX_CHAT_QUOTES, quoteText } from '../../shared/side-threads';
import { snapshotCapabilities, type ToolCapability } from '../../shared/tool-policy';
import { defaultBrowserChoice, narrowBrowserChoice } from '../../shared/browser';
import { Store, id, now } from '../storage/database';
import type { WorkspaceGrants } from '../storage/workspace-grants';

/**
 * Side threads of an orglet's main chat (COD-247): who they belong to, and how their permissions stay inside the
 * main chat's. A side thread starts with a copy of the main chat's tool permissions, working-folder grant and MCP
 * grants. It never gets wider than the main chat: widening one on a side thread is refused, and whatever the main
 * chat loses its side threads lose too, the moment it changes. Running side runs then meet the same checks a main
 * chat run meets after a revoke.
 */
export class SideThreads {
  constructor(private store: Store, private grants: WorkspaceGrants) {}

  /** Every side thread started from this main chat that still exists, archived ones included. */
  of(mainTaskId: string): Task[] {
    return this.store.all<Task>('tasks').filter(task => task.sideOf?.taskId === mainTaskId && !task.deletedAt);
  }

  /** The main chat a side thread was started from, while its row exists and is not deleted. */
  parentOf(side: Task): Task | undefined {
    if (!side.sideOf) return undefined;
    const row = this.store.db.prepare('SELECT data FROM tasks WHERE id=?').get(side.sideOf.taskId);
    if (!row) return undefined;
    const parent = JSON.parse(String(row.data)) as Task;
    return parent.deletedAt ? undefined : parent;
  }

  /** Refuses a chat a side thread cannot start from, saying why. */
  assertCanStart(main: Task) {
    if (main.sideOf) throw new Error('Chat phụ chỉ mở được từ chat chính của Tí.');
    if (main.teamId) throw new Error('Chat phụ chưa có cho hội. Nhắn trong chat của hội.');
    if (main.assignees) throw new Error('Chat phụ chưa có cho chat nhóm. Nhắn trong chat nhóm.');
    if (!canStartSideThread(main)) throw new Error('Chat này đã đóng. Mở chat chính của Tí để bắt đầu chat phụ.');
  }

  /** What a chat may use: its own set, or its orglet's defaults when it never chose one. */
  capabilitiesOf(task: Task): ToolCapability[] {
    const worker = this.store.get<Worker>('workers', task.workerId);
    return snapshotCapabilities(worker.provider, task.toolCapabilities);
  }

  /** Refuses a set of tool permissions on a side thread that its main chat does not have. */
  assertCapabilitiesWithin(side: Task, capabilities: readonly ToolCapability[]) {
    const main = this.parentOf(side);
    const allowed = this.capabilitiesOf(main ?? side);
    if (capabilities.some(capability => !allowed.includes(capability))) throw new Error('Chat phụ không có quyền rộng hơn chat chính. Đổi quyền ở chat chính.');
  }

  /**
   * After the main chat's tool permissions changed: each side thread keeps only the ones the main chat still has.
   * Returns the side threads that lost one, whose running work the caller stops.
   */
  narrowCapabilities(main: Task): string[] {
    const allowed = this.capabilitiesOf(main);
    const reduced: string[] = [];
    for (const side of this.of(main.id)) {
      const current = this.capabilitiesOf(side);
      const kept = current.filter(capability => allowed.includes(capability));
      if (kept.length === current.length) continue;
      this.store.patchTask(side.id, { toolCapabilities: kept });
      reduced.push(side.id);
    }
    return reduced;
  }

  /** Refuses an MCP grant on a side thread that its main chat does not already give. */
  assertMcpGrantWithin(side: Task, grant: McpGrant) {
    const main = this.parentOf(side);
    if (!main || !mainChatGives(main.mcpGrants, grant)) throw new Error('Chat phụ không có quyền MCP rộng hơn chat chính. Cho phép ở chat chính.');
  }

  /**
   * After the main chat took an MCP grant away: each side thread drops every grant the main chat no longer gives. A
   * call already running keeps going; the next one asks again, as it does in the main chat (COD-241).
   */
  narrowMcpGrants(main: Task) {
    for (const side of this.of(main.id)) {
      const current = side.mcpGrants ?? [];
      const kept = current.filter(grant => mainChatGives(main.mcpGrants, grant));
      if (kept.length !== current.length) this.store.patchTask(side.id, { mcpGrants: kept });
    }
  }

  /**
   * After the main chat's browser changed (COD-261): each side thread keeps its copy inside the main chat's, the same
   * narrowing every browser step applies anyway, so what Details shows for a side thread matches what it may use.
   */
  narrowBrowser(main: Task) {
    const mainChoice = main.browser ?? defaultBrowserChoice();
    for (const side of this.of(main.id)) {
      const narrowed = narrowBrowserChoice(side.browser ?? defaultBrowserChoice(), mainChoice);
      if (JSON.stringify(narrowed) !== JSON.stringify(side.browser ?? defaultBrowserChoice())) this.store.patchTask(side.id, { browser: narrowed });
    }
  }

  /**
   * After the main chat's folder changed or was revoked: each side thread's grant is narrowed to match. Returns the
   * side threads whose grant changed, whose running work the caller stops.
   */
  narrowWorkspace(main: Task): string[] {
    return this.of(main.id).filter(side => this.grants.narrowTo(side.id, main.id)).map(side => side.id);
  }

  /**
   * Where "Bring into main chat" puts an answer: the main chat the side thread came from while it is open, or else
   * the orglet's current main chat.
   */
  mainChatFor(side: Task): Task | undefined {
    const parent = this.parentOf(side);
    if (parent && !parent.archivedAt) return parent;
    return liveWorkerTask(this.store.all<Task>('tasks'), side.workerId);
  }

  /**
   * Copies a side thread's answer into its main chat as a quoted message, after the main chat's latest turn. It
   * starts nothing: the orglet reads the quote with the next message the person sends there. Bringing the same
   * answer in again changes nothing. Returns the main chat's id.
   */
  bringIn(artifactId: string): string {
    const artifact = this.store.get<Artifact>('artifacts', artifactId);
    const run = this.store.get<Run>('runs', artifact.runId);
    const side = this.store.get<Task>('tasks', run.taskId);
    if (side.deletedAt || !side.sideOf) throw new Error('Chỉ câu trả lời trong chat phụ mới đưa vào chat chính được.');
    const main = this.mainChatFor(side);
    if (!main) throw new Error('Chưa có chat chính để đưa vào. Nhắn cho Tí trong chat chính trước.');
    const quotes = main.quotes ?? [];
    if (quotes.some(quote => quote.artifactId === artifactId)) return main.id;
    if (quotes.length >= MAX_CHAT_QUOTES) throw new Error('Chat chính đã có quá nhiều tin đưa vào.');
    const report = artifact.report;
    const body = report.format === 'chat' ? report.summary : `${report.title}\n\n${report.summary}`;
    const quote = ChatQuote.parse({
      id: id(), fromTaskId: side.id, artifactId, author: run.snapshot.worker.name, authorId: run.snapshot.worker.id, text: quoteText(body),
      afterRevision: main.inputRevision ?? 0, createdAt: now(),
    });
    this.store.patchTask(main.id, { quotes: [...quotes, quote] });
    return main.id;
  }
}

/** Whether the main chat's grants cover this one: a whole-server grant needs a whole-server grant there. */
function mainChatGives(mainGrants: readonly McpGrant[] | undefined, grant: McpGrant): boolean {
  if (grant.tool === null) return (mainGrants ?? []).some(item => item.serverId === grant.serverId && item.tool === null);
  return mcpCallGranted(mainGrants, grant.serverId, grant.tool);
}
