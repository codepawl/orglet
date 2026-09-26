import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';
import { LiveRun } from '../../apps/desktop/src/renderer/components/LiveRun';
import { TurnTrace } from '../../apps/desktop/src/renderer/components/TurnTrace';
import { liveTraceOf, traceOf, traceSummary } from '../../apps/desktop/src/renderer/turnTrace';
import type { Activity, Artifact, Run, Skill, Task, TaskDetail, Worker } from '../../apps/desktop/src/shared/contracts';
import type { RunContext } from '../../apps/desktop/src/shared/knowledge';

/*
 * COD-220: everything a worker did before its answer sits behind one folded control above the bubble, in the order it
 * happened: the memories it was given, the notes it loaded, then the steps the core saved. The chat names only what
 * the core recorded, so a connection it sees nothing of gets no trace at all.
 */

const taskId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222221';
const planRunId = '22222222-2222-4222-8222-222222222222';
const memberRunId = '22222222-2222-4222-8222-222222222223';
const artifactId = '33333333-3333-4333-8333-333333333331';
const skillId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const noteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const memoryId = '55555555-5555-4555-8555-555555555551';
const at = '2026-09-24T09:00:00.000Z';

const skill: Skill = { id: skillId, revision: 1, name: 'Skill', content: 'Help.' };
const worker: Worker = { id: '44444444-4444-4444-8444-444444444441', revision: 1, name: 'Scout', instructions: 'Work.', provider: 'anthropic', skillId };
const writer: Worker = { id: '44444444-4444-4444-8444-444444444442', revision: 1, name: 'Writer', instructions: 'Write.', provider: 'anthropic', skillId };
const task: Task = { id: taskId, workerId: worker.id, brief: 'Tóm tắt hóa đơn.', sourceIds: [], consent: true, budgetMicros: 100_000, accepted: false, status: 'completed', createdAt: at };
const memory = { id: memoryId, revision: 1, text: 'Thích câu trả lời ngắn.' };
const hash = 'a'.repeat(64);
const context: RunContext = {
  knowledge: [{ id: noteId, revision: 2, title: 'Quy ước hóa đơn', content: 'Số tiền ghi bằng VND.', tags: [], hash, scope: { type: 'workspace' }, pinned: false }],
  memories: [{ ...memory, scope: { type: 'worker', id: worker.id }, pinned: false, hash }],
  manifest: { bytes: 10, loaded: [{ kind: 'knowledge', id: noteId, revision: 2, hash, bytes: 10 }], omitted: [] },
};

function runOf(id: string, by: Worker, stage?: Run['stage'], runContext?: RunContext): Run {
  return { id, taskId, stage, status: 'completed', startedAt: at, error: null, snapshot: { worker: by, skill, inputRevision: 0, input: { brief: task.brief, sourceIds: [] }, context: runContext } };
}

let eventCounter = 0;
function eventOf(ofRunId: string, message: string): Activity {
  eventCounter += 1;
  return { id: `66666666-6666-4666-8666-${String(eventCounter).padStart(12, '0')}`, runId: ofRunId, sequence: eventCounter, message, createdAt: at };
}

function answerOf(usedMemories?: { id: string; revision: number; text: string }[]): Artifact {
  return { id: artifactId, runId, createdAt: at, hash: 'b'.repeat(64), usedMemories, report: { format: 'chat', title: 'Tóm tắt', summary: 'Hóa đơn tháng 9 là 1.200.000đ.', findings: [], limitations: [] } };
}

function renderThread(runs: Run[], events: Activity[], artifact: Artifact, openMemories?: (workerId: string) => void) {
  const detail: TaskDetail = { task, runs, events, artifacts: [artifact], profiles: [], preflights: [], sources: [], workspaceEvidence: [], appProposals: [],
    usage: { chargedMicros: 0, reservedMicros: 0, uncertainCount: 0, inputTokens: 0, outputTokens: 0 } };
  return renderToStaticMarkup(createElement(TaskThread, {
    detail, workspace: { workers: [worker, writer], skills: [skill], tasks: [task] }, action: () => {}, showSources: () => {}, openMessage: () => {},
    proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {}, openMemories,
    proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
  }));
}

/** Where each marker first appears after the answer starts, so the order can be read off the numbers. */
function orderOf(html: string, markers: string[]) {
  const start = html.indexOf('class="assistant-message"');
  const answer = html.slice(start);
  const found = markers.map(marker => answer.indexOf(marker));
  for (const [index, position] of found.entries()) expect(position, `${markers[index]} is on the page`).toBeGreaterThan(-1);
  return found;
}

it('renders exactly one trace control before the bubble, with the memory, the note, the files read and the steps inside it in order', () => {
  const events = [
    eventOf(runId, 'Đang gọi model · bước 1/6'),
    eventOf(runId, 'Đã đọc invoice.xlsx'),
    eventOf(runId, 'Đã tìm kiếm web; kết quả chưa được xác minh.'),
    eventOf(runId, 'Đã đọc tài nguyên skill: references/invoices.md'),
    eventOf(runId, 'Đã ghi nhớ một điều cho các cuộc trò chuyện sau.'),
    eventOf(runId, 'Đã lưu câu trả lời.'),
  ];
  const html = renderThread([runOf(runId, worker, undefined, context)], events, answerOf([memory]), () => {});
  expect(html.match(/class="turn-trace"/g)).toHaveLength(1);
  expect(html).not.toContain('used-memories');
  const [trace, memoryRow, noteRow, readRow, webRow, skillRow, rememberedRow, link, bubble] = orderOf(html, [
    'class="turn-trace"', 'Thích câu trả lời ngắn.', 'Quy ước hóa đơn', 'invoice.xlsx', 'Searched the web', 'references/invoices.md',
    'Remembered something for later chats.', 'Open the Memory tab', `id="message-${artifactId}"`,
  ]);
  expect([trace, memoryRow, noteRow, readRow, webRow, skillRow, rememberedRow, link, bubble]).toEqual([...[trace, memoryRow, noteRow, readRow, webRow, skillRow, rememberedRow, link, bubble]].sort((a, b) => a - b));
  // The folded line counts each kind; the runner's own status lines are not actions and count for nothing.
  expect(html).toContain('Used 1 memory · Loaded 1 note · Read 1 file · Read 1 skill resource · Went online once · Remembered 1 thing');
  expect(html).not.toContain('Đang gọi model');
  // A real disclosure with a list a screen reader can read.
  expect(html).toContain('<details class="turn-trace"><summary class="activity-summary">');
  expect(html).toContain('<ol class="trace-list" aria-label="What the orglet did">');
});

it('renders nothing when the trace is empty', () => {
  const html = renderThread([runOf(runId, worker)], [eventOf(runId, 'Đã lưu câu trả lời.')], answerOf());
  expect(html).not.toContain('turn-trace');
  expect(html).not.toContain('class="turn-before"');
  expect(html).toContain(`id="message-${artifactId}"`);
});

it('invents no actions for a connection the core sees nothing of', () => {
  const cursor: Worker = { ...worker, provider: 'cursor' };
  const events = [eventOf(runId, 'Đang chạy Cursor Agent 1.0 trên máy · chỉ đọc bản sao nguồn của task'), eventOf(runId, 'Đã lưu câu trả lời.')];
  const html = renderThread([runOf(runId, cursor)], events, answerOf());
  expect(html).not.toContain('turn-trace');
  expect(traceOf({ runId, events })).toEqual([]);
});

it('marks a refusal as a quieter row and counts it as a step that did not go through', () => {
  const events = [eventOf(runId, 'Cảm xúc thứ 1 bị từ chối: tin nhắn không tồn tại.'), eventOf(runId, 'Không ghi nhớ được: Lượt chạy này không thuộc hội nào; ghi nhớ cho Tí hoặc toàn workspace.')];
  const entries = traceOf({ runId, events });
  expect(entries.map(entry => entry.kind)).toEqual(['failed', 'failed']);
  expect(traceSummary(entries)).toBe('2 steps did not go through');
  const html = renderToStaticMarkup(createElement(TurnTrace, { entries }));
  expect(html.match(/class="trace-row trace-row-muted"/g)).toHaveLength(2);
  expect(html).not.toContain('Open the Memory tab');
});

it('reads a saved step from each sentence the core writes, the specific ones before the plain read', () => {
  const events = [
    eventOf(runId, 'Đã đọc trang web dưới dạng dữ liệu không đáng tin.'),
    eventOf(runId, 'Đã kiểm tra dataset: sales.csv, refunds.csv · toàn bộ dữ liệu trong giới hạn checker.'),
    eventOf(runId, 'Workspace read: src/index.ts'),
    eventOf(runId, 'Workspace write: src/index.ts'),
    eventOf(runId, 'Workspace list: src'),
    eventOf(runId, 'Đã liệt kê tệp docs'),
    eventOf(runId, 'Đã tìm budget'),
    eventOf(runId, 'Tiến trình đã dừng: exited, mã thoát 0'),
    eventOf(runId, 'Đã ghi một đề xuất thay đổi trong app; chờ bạn áp dụng.'),
  ];
  expect(traceOf({ runId, events }).map(entry => [entry.kind, entry.target ?? entry.note])).toEqual([
    ['web_read', undefined],
    ['dataset', 'sales.csv, refunds.csv'],
    ['read', 'src/index.ts'],
    ['edit', 'src/index.ts'],
    ['list', 'src'],
    ['list', 'docs'],
    ['search', 'budget'],
    ['command', 'Tiến trình đã dừng: exited, mã thoát 0'],
    ['proposal', 'Đã ghi một đề xuất thay đổi trong app; chờ bạn áp dụng.'],
  ]);
  expect(traceSummary(traceOf({ runId, events }))).toBe('Read 1 file · Searched once · Listed files 2 times · Went online once · Checked data once · Edited 1 file · Ran 1 command · Proposed 1 change');
});

it('names each command it ran and how it ended, and still reads the older sentence that did not', () => {
  const events = [
    eventOf(runId, 'Đã chạy lệnh npm test · mã thoát 1'),
    eventOf(runId, 'Lệnh node build.js đã hết thời gian'),
    eventOf(runId, 'Đã dừng lệnh npm run dev'),
    eventOf(runId, 'Lệnh npm run lint in quá nhiều nên đã bị dừng'),
    eventOf(runId, 'Tiến trình đã dừng: exited, mã thoát 0'),
  ];
  const entries = traceOf({ runId, events });
  expect(entries.map(entry => entry.kind)).toEqual(['command', 'command', 'command', 'command', 'command']);
  expect(traceSummary(entries)).toBe('Ran 5 commands');
  const html = renderToStaticMarkup(createElement(TurnTrace, { entries }));
  expect(html).toContain('Ran npm test · exit code 1');
  expect(html).toContain('node build.js timed out');
  expect(html).toContain('Stopped npm run dev');
  expect(html).toContain('npm run lint printed too much and was stopped');
});

it('reads folders, moves and deletions as their own rows, and a refused one as a step that did not go through (COD-254)', () => {
  const events = [
    eventOf(runId, 'Workspace create_folder: receipts'),
    eventOf(runId, 'Workspace move: receipt 3.pdf → receipts/march.pdf'),
    eventOf(runId, 'Workspace move: IMG_0412.jpg → images/photo.jpg'),
    eventOf(runId, 'Workspace delete: contract-old.pdf'),
    eventOf(runId, 'Không chuyển được: notes.txt → contract-old.pdf'),
    // The hand-in's own sentences come after the answer and stay in Details.
    eventOf(runId, 'Đã chuyển tệp: receipt 3.pdf → receipts/march.pdf'),
    eventOf(runId, 'Đã tạo thư mục: receipts'),
  ];
  const entries = traceOf({ runId, events });
  expect(entries.map(entry => [entry.kind, entry.target ?? entry.note])).toEqual([
    ['folder', 'receipts'],
    ['move', 'receipt 3.pdf → receipts/march.pdf'],
    ['move', 'IMG_0412.jpg → images/photo.jpg'],
    ['delete', 'contract-old.pdf'],
    ['failed', 'Không chuyển được: notes.txt → contract-old.pdf'],
  ]);
  expect(traceSummary(entries)).toBe('Created 1 folder · Moved 2 items · Deleted 1 item · 1 step did not go through');
  const html = renderToStaticMarkup(createElement(TurnTrace, { entries }));
  expect(html).toContain('<span class="trace-verb">Moved</span><span class="trace-target">receipt 3.pdf → receipts/march.pdf</span>');
  expect(html).toContain('Could not move: notes.txt → contract-old.pdf');
});

it('gives a crew answer its handoffs before the synthesis steps, one per member, and keeps the members\' own steps out', () => {
  const lead = runOf(planRunId, worker, 'plan');
  const member = runOf(memberRunId, writer, 'member');
  const synthesis = runOf(runId, worker, 'synthesis');
  const events = [
    eventOf(planRunId, 'Đang phân việc.'),
    eventOf(planRunId, 'Đã phân việc: Writer viết phần tóm tắt.'),
    eventOf(planRunId, 'Đã giao lại phần việc cho Writer: phần đầu chưa đủ.'),
    eventOf(memberRunId, 'Đã đọc invoice.xlsx'),
    eventOf(runId, 'Đang tổng hợp 1 kết quả đã lưu.'),
    eventOf(runId, 'Đã đọc summary.md'),
  ];
  const entries = traceOf({ runId, events, crew: [lead, member, synthesis] });
  expect(entries.map(entry => [entry.kind, entry.target ?? entry.note])).toEqual([
    ['handoff', 'Đã giao lại phần việc cho Writer: phần đầu chưa đủ.'],
    ['handoff', 'Writer'],
    ['read', 'summary.md'],
  ]);
  expect(traceSummary(entries)).toBe('Handed off 2 jobs · Read 1 file');
  // The same runs without a synthesis author add nothing.
  expect(traceOf({ runId, events }).map(entry => entry.target)).toEqual(['summary.md']);
  const html = renderThread([lead, member, synthesis], events, answerOf());
  expect(html).toContain('Handed off 2 jobs · Read 1 file');
  expect(html).toContain('Reassigned work to Writer: phần đầu chưa đủ.');
  expect(html).toContain('Handed off to</span><span class="trace-target">Writer</span>');
});

it('keeps one trace while the answer streams, the memories first and an open step marked', () => {
  const entries = liveTraceOf(context.memories, [{ id: 's1', kind: 'read', target: 'invoice.xlsx', done: true }, { id: 's2', kind: 'other', target: 'Bash', done: false }]);
  expect(entries.map(entry => [entry.kind, entry.running ?? false])).toEqual([['memory', false], ['read', false], ['other', true]]);
  const html = renderToStaticMarkup(createElement(LiveRun, {
    update: { taskId, runId, startedAt: Date.now(), progress: { thinking: 'Đang cân nhắc.', preamble: '', answer: 'Hóa đơn', activity: [{ id: 's1', kind: 'read', target: 'invoice.xlsx', done: true }, { id: 's2', kind: 'other', target: 'Bash', done: false }], writing: false } },
    memories: context.memories,
  }));
  expect(html.match(/class="turn-trace"/g)).toHaveLength(1);
  expect(html).toContain('Used 1 memory · Read 1 file · 1 other step');
  expect(html).toContain('class="trace-row running"');
  // The tool's name is never shown; the timer and the notes sit after the rows.
  expect(html).not.toContain('Bash');
  expect(html.indexOf('class="trace-list"')).toBeLessThan(html.indexOf('class="activity-elapsed"'));
  expect(html).toContain('Đang cân nhắc.');
});

it('shows the timer alone while a run has streamed nothing to trace', () => {
  const html = renderToStaticMarkup(createElement(LiveRun, {
    update: { taskId, runId, startedAt: Date.now(), progress: { thinking: '', preamble: '', answer: '', activity: [], writing: false } },
  }));
  expect(html).not.toContain('turn-trace');
  expect(html).toContain('activity-elapsed-plain');
});
