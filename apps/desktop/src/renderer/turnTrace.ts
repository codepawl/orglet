import type { Activity, Run, UsedMemory } from '../shared/contracts';
import type { RunContext, RunMemory } from '../shared/knowledge';
import type { ActivityStep } from '../shared/progress';
import { t } from './i18n';

/**
 * What one worker turn did before its answer, as one ordered list (COD-220, user: "memories used should sit inside
 * a collapsible section that holds all of the worker's actions"). The rule of docs/worker-actions.md holds: an entry
 * is something the core recorded (a memory it froze, a note it loaded, an event it saved), never a guess from the
 * answer text, so a connection the core sees little of gets a short trace or none.
 */
export type TraceKind =
  | 'memory' | 'knowledge'
  | 'read' | 'search' | 'list' | 'skill' | 'web_search' | 'web_read' | 'dataset' | 'edit' | 'folder' | 'move' | 'delete' | 'command' | 'mcp'
  | 'browser_open' | 'browser_read' | 'browser_find' | 'browser_screenshot' | 'browser_scroll' | 'browser_act' | 'browser_wait' | 'browser_asked'
  | 'handoff' | 'remembered' | 'proposal' | 'failed' | 'other';

export type TraceEntry = {
  id: string;
  kind: TraceKind;
  /** What the step touched: a file name, a search pattern, a memory's text, a note's title, a member's name. */
  target?: string;
  /** The core's own sentence for a row that is a note rather than a verb and a target (a refusal, a stored memory). Kept in Vietnamese as saved; the row translates it. */
  note?: string;
  /** A live step still going. */
  running?: boolean;
};

/**
 * How a saved event reads as a trace row. The first matching pattern wins, so the specific sentences (a skill
 * resource, a web page) sit above the plain "Đã đọc …" they would otherwise match. Status lines the runner writes
 * for itself (calling the model, saving the answer, costs) match nothing and are left out: they are not actions.
 */
const eventPatterns: { pattern: RegExp; kind: TraceKind; note?: boolean }[] = [
  { pattern: /^Đã đọc tài nguyên skill: (.+)$/, kind: 'skill' },
  // An MCP call names the tool and its server, "search_issues · GitHub" (COD-241).
  { pattern: /^Đã dùng công cụ MCP: (.+)$/, kind: 'mcp' },
  { pattern: /^(?:Công cụ MCP không thành công|Bạn đã từ chối công cụ MCP|Công cụ MCP chưa được phép trong chat này): /, kind: 'failed', note: true },
  { pattern: /^Không khởi động được máy chủ MCP /, kind: 'failed', note: true },
  { pattern: /^Đã đọc trang web dưới dạng dữ liệu không đáng tin\.$/, kind: 'web_read' },
  { pattern: /^Đã tìm kiếm web; kết quả chưa được xác minh\.$/, kind: 'web_search' },
  { pattern: /^(?:Không đọc được trang web|Tìm kiếm web không thành công): /, kind: 'failed', note: true },
  // Orglet's browser (COD-261), below the web lines: "Đã đọc trang web …" is the web tool's, not a browser page.
  { pattern: /^Đã mở trang (.+)$/, kind: 'browser_open' },
  { pattern: /^Đã đọc trang (.+)$/, kind: 'browser_read' },
  { pattern: /^Đã tìm trên trang (.+)$/, kind: 'browser_find' },
  { pattern: /^Đã chụp màn hình (.+)$/, kind: 'browser_screenshot' },
  { pattern: /^Đã cuộn trang (.+)$/, kind: 'browser_scroll' },
  // Acting on a page reads as the core's whole sentence, since it names the element: "Đã bấm “Tìm” trên example.com".
  // A step Orglet asked about says so and how the person answered; a declined one did not go through.
  { pattern: /^Đã hỏi để .+ · được phép$/, kind: 'browser_asked', note: true },
  { pattern: /^Đã hỏi để .+ · bị từ chối$/, kind: 'failed', note: true },
  { pattern: /^Đã (?:bấm|gõ vào|chọn trong) “.*” trên \S+$/, kind: 'browser_act', note: true },
  { pattern: /^Đã nhấn \S+ trên \S+$/, kind: 'browser_act', note: true },
  { pattern: /^Đã chờ trang \S+$/, kind: 'browser_wait', note: true },
  { pattern: /^Trình duyệt không (?:mở|làm được|làm bước này)/, kind: 'failed', note: true },
  { pattern: /^Đã kiểm tra (?:dataset|run-log): (.+?) · /, kind: 'dataset' },
  { pattern: /^Đã đọc (.+)$/, kind: 'read' },
  { pattern: /^Đã tìm (.+)$/, kind: 'search' },
  { pattern: /^Đã liệt kê tệp (.+)$/, kind: 'list' },
  { pattern: /^Workspace (?:read|blob): (.+)$/, kind: 'read' },
  { pattern: /^Workspace search: (.+)$/, kind: 'search' },
  { pattern: /^Workspace write: (.+)$/, kind: 'edit' },
  { pattern: /^Workspace create_folder: (.+)$/, kind: 'folder' },
  { pattern: /^Workspace move: (.+)$/, kind: 'move' },
  { pattern: /^Workspace delete: (.+)$/, kind: 'delete' },
  { pattern: /^Workspace list: (.+)$/, kind: 'list' },
  { pattern: /^Workspace (?:manifest|snapshot): ?$/, kind: 'other' },
  { pattern: /^Không có tệp hoặc thư mục: /, kind: 'failed', note: true },
  { pattern: /^Không (?:chuyển|xóa|tạo) được/, kind: 'failed', note: true },
  { pattern: /^Tiến trình đã dừng: /, kind: 'command', note: true },
  { pattern: /^(?:Đã ghi nhớ một điều|Đã gộp vào một ghi nhớ|Đã ghi một ghi nhớ)/, kind: 'remembered', note: true },
  { pattern: /^Không ghi nhớ được/, kind: 'failed', note: true },
  { pattern: /^Câu trả lời kèm /, kind: 'failed', note: true },
  { pattern: /^Cảm xúc thứ \d+ bị từ chối/, kind: 'failed', note: true },
  { pattern: /^Đề xuất (?:thay đổi trong app|sửa hướng dẫn của Tí) bị từ chối/, kind: 'failed', note: true },
  { pattern: /^Không xử lý được đề xuất/, kind: 'failed', note: true },
  { pattern: /^Đã ghi một đề xuất /, kind: 'proposal', note: true },
  { pattern: /^Đã phân việc/, kind: 'handoff', note: true },
  { pattern: /^Đã giao lại phần việc cho /, kind: 'handoff', note: true },
];

function entryOfEvent(event: Activity): TraceEntry | undefined {
  for (const { pattern, kind, note } of eventPatterns) {
    const match = pattern.exec(event.message);
    if (!match) continue;
    if (note) return { id: event.id, kind, note: event.message };
    return match[1] ? { id: event.id, kind, target: match[1] } : { id: event.id, kind };
  }
  return undefined;
}

/** The trace rows a finished run's saved events give, oldest first. */
export function entriesOfEvents(events: readonly Activity[], runId: string): TraceEntry[] {
  const entries: TraceEntry[] = [];
  for (const event of events) {
    if (event.runId !== runId) continue;
    const entry = entryOfEvent(event);
    if (entry) entries.push(entry);
  }
  return entries;
}

function memoryEntries(memories: readonly Pick<UsedMemory, 'id' | 'text'>[] | undefined): TraceEntry[] {
  return (memories ?? []).map(memory => ({ id: `memory-${memory.id}`, kind: 'memory' as const, target: memory.text }));
}

/** The notes that reached the model, from the manifest the run froze (omitted ones are not part of what it did). */
function knowledgeEntries(context: RunContext | undefined): TraceEntry[] {
  if (!context) return [];
  return context.manifest.loaded.filter(entry => entry.kind === 'knowledge').map((entry, index) => {
    const note = context.knowledge.find(item => item.id === entry.id);
    return { id: `knowledge-${entry.id ?? index}`, kind: 'knowledge' as const, target: note?.title ?? t('Ghi chú') };
  });
}

/**
 * A crew's answer is the synthesis; the handing out happened before it, on the lead's plan run and the members'
 * runs. Those read as handoffs at the top of the trace, one per member, while the members' own steps stay in
 * Details with their jobs.
 */
function crewEntries(runs: readonly Run[], events: readonly Activity[]): TraceEntry[] {
  const entries: TraceEntry[] = [];
  for (const run of runs) {
    // A reassignment is a handoff of its own; the split itself ("Đã phân việc …") is the member rows below, and the
    // lead's note on it stays in Details with the plan.
    if (run.stage === 'plan') entries.push(...entriesOfEvents(events, run.id).filter(entry => entry.kind === 'handoff' && /^Đã giao lại/.test(entry.note ?? '')));
  }
  const members = new Map<string, Run>();
  for (const run of runs) {
    if (run.stage === 'member' && !members.has(run.snapshot.worker.id)) members.set(run.snapshot.worker.id, run);
  }
  for (const run of members.values()) entries.push({ id: `handoff-${run.id}`, kind: 'handoff', target: run.snapshot.worker.name });
  return entries;
}

/**
 * The trace of a finished answer, in the order things happened: the memories it was written with (frozen on the
 * artifact, so an edit later never changes it), the notes its context loaded, a crew's handoffs, then the steps
 * the core saved as the answering run's events. `crew` is the turn's runs when the answer is a synthesis, else empty.
 */
export function traceOf({ memories, context, runId, events, crew = [] }: {
  memories?: readonly UsedMemory[]; context?: RunContext; runId: string; events: readonly Activity[]; crew?: readonly Run[];
}): TraceEntry[] {
  return [...memoryEntries(memories), ...knowledgeEntries(context), ...crewEntries(crew, events), ...entriesOfEvents(events, runId)];
}

/**
 * The trace while the answer streams: the memories the run froze, then the steps streamed so far, open ones marked.
 * A step that is not a read, search or list carries the tool's name as its target, which says nothing to the person
 * reading and is not what the worker did, so it is left off (the island leaves it off for the same reason).
 */
export function liveTraceOf(memories: readonly RunMemory[] | undefined, steps: readonly ActivityStep[]): TraceEntry[] {
  const stepEntries = steps.map(step => ({ id: step.id, kind: step.kind, target: step.kind === 'other' ? undefined : step.target, running: !step.done }));
  return [...memoryEntries(memories), ...stepEntries];
}

/** Which summary count a row adds to; the two web kinds share one, and every browser step counts as one kind. */
type SummaryKind = Exclude<TraceKind, 'web_search' | 'web_read' | BrowserKind> | 'web' | 'browser';
type BrowserKind = 'browser_open' | 'browser_read' | 'browser_find' | 'browser_screenshot' | 'browser_scroll' | 'browser_act' | 'browser_wait' | 'browser_asked';
const browserKinds: readonly TraceKind[] = ['browser_open', 'browser_read', 'browser_find', 'browser_screenshot', 'browser_scroll', 'browser_act', 'browser_wait', 'browser_asked'];

/** The order the counts read in: what was loaded, then a crew's handoffs, then the steps, then what the run left behind. */
const summaryOrder: SummaryKind[] = ['memory', 'knowledge', 'handoff', 'read', 'search', 'list', 'skill', 'web', 'browser', 'mcp', 'dataset', 'edit', 'folder', 'move', 'delete', 'command', 'remembered', 'proposal', 'failed', 'other'];

function summaryKindOf(kind: TraceKind): SummaryKind {
  if (kind === 'web_search' || kind === 'web_read') return 'web';
  if (browserKinds.includes(kind)) return 'browser';
  return kind as SummaryKind;
}

/** One count phrase per kind, with its own words for one and for several, so no plural is glued on. */
function countPhrase(kind: SummaryKind, count: number): string {
  switch (kind) {
    case 'memory': return count === 1 ? t('Dùng 1 ghi nhớ') : t('Dùng {0} ghi nhớ', [count]);
    case 'knowledge': return count === 1 ? t('Nạp 1 ghi chú') : t('Nạp {0} ghi chú', [count]);
    case 'read': return count === 1 ? t('Đọc 1 tệp') : t('Đọc {0} tệp', [count]);
    case 'search': return count === 1 ? t('Tìm 1 lần') : t('Tìm {0} lần', [count]);
    case 'list': return count === 1 ? t('Liệt kê tệp 1 lần') : t('Liệt kê tệp {0} lần', [count]);
    case 'skill': return count === 1 ? t('Đọc 1 tài nguyên skill') : t('Đọc {0} tài nguyên skill', [count]);
    case 'web': return count === 1 ? t('Lên web 1 lần') : t('Lên web {0} lần', [count]);
    case 'mcp': return count === 1 ? t('Dùng 1 công cụ MCP') : t('Dùng {0} công cụ MCP', [count]);
    case 'browser': return count === 1 ? t('1 bước trên trình duyệt') : t('{0} bước trên trình duyệt', [count]);
    case 'dataset': return count === 1 ? t('Kiểm tra dữ liệu 1 lần') : t('Kiểm tra dữ liệu {0} lần', [count]);
    case 'edit': return count === 1 ? t('Sửa 1 tệp') : t('Sửa {0} tệp', [count]);
    case 'folder': return count === 1 ? t('Tạo 1 thư mục') : t('Tạo {0} thư mục', [count]);
    case 'move': return count === 1 ? t('Chuyển 1 mục') : t('Chuyển {0} mục', [count]);
    case 'delete': return count === 1 ? t('Xóa 1 mục') : t('Xóa {0} mục', [count]);
    case 'command': return count === 1 ? t('Chạy 1 lệnh') : t('Chạy {0} lệnh', [count]);
    case 'handoff': return count === 1 ? t('Giao 1 việc') : t('Giao {0} việc', [count]);
    case 'remembered': return count === 1 ? t('Ghi nhớ thêm 1 điều') : t('Ghi nhớ thêm {0} điều', [count]);
    case 'proposal': return count === 1 ? t('Đề xuất 1 thay đổi') : t('Đề xuất {0} thay đổi', [count]);
    case 'failed': return count === 1 ? t('1 bước không thành') : t('{0} bước không thành', [count]);
    case 'other': return count === 1 ? t('1 bước khác') : t('{0} bước khác', [count]);
  }
}

/** The folded line: one count per kind of thing that happened, in a fixed order, joined by a middle dot. */
export function traceSummary(entries: readonly TraceEntry[]): string {
  const counts = new Map<SummaryKind, number>();
  for (const entry of entries) {
    const kind = summaryKindOf(entry.kind);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return summaryOrder.filter(kind => counts.has(kind)).map(kind => countPhrase(kind, counts.get(kind)!)).join(' · ');
}
