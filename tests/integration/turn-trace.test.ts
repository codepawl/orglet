import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';
import { LiveRun } from '../../apps/desktop/src/renderer/components/LiveRun';
import { WorkLog } from '../../apps/desktop/src/renderer/components/WorkLog';
import { diffFileOf, liveTraceOf, traceOf, traceStatusOf, traceSummary } from '../../apps/desktop/src/renderer/turnTrace';
import type { Activity, Artifact, Run, Skill, Task, TaskDetail, Worker } from '../../apps/desktop/src/shared/contracts';
import type { RunContext } from '../../apps/desktop/src/shared/knowledge';
import { translateMessage } from '../../apps/desktop/src/shared/i18n';
import { en } from '../../apps/desktop/src/shared/locales/en';

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

function renderThread(runs: Run[], events: Activity[], artifact: Artifact, openMemories?: (workerId: string) => void, showWork = true) {
  const detail: TaskDetail = { task, runs, events, artifacts: [artifact], profiles: [], preflights: [], sources: [], workspaceEvidence: [], appProposals: [],
    usage: { chargedMicros: 0, reservedMicros: 0, uncertainCount: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  return renderToStaticMarkup(createElement(TaskThread, {
    detail, workspace: { workers: [worker, writer], skills: [skill], tasks: [task], showWork }, action: () => {}, showSources: () => {}, openMessage: () => {},
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

it('renders exactly one work log before the bubble: the memory and note folded first, then the steps in the order they happened', () => {
  const events = [
    eventOf(runId, 'Đang gọi model · bước 1/6'),
    eventOf(runId, 'Đã đọc invoice.xlsx'),
    eventOf(runId, 'Đã tìm kiếm web; kết quả chưa được xác minh.'),
    eventOf(runId, 'Đã đọc tài nguyên skill: references/invoices.md'),
    eventOf(runId, 'Đã ghi nhớ một điều cho các cuộc trò chuyện sau.'),
    eventOf(runId, 'Đã lưu câu trả lời.'),
  ];
  const html = renderThread([runOf(runId, worker, undefined, context)], events, answerOf([memory]), () => {});
  expect(html.match(/class="work-log"/g)).toHaveLength(1);
  expect(html).not.toContain('used-memories');
  const [trace, memoryRow, noteRow, link, readRow, webRow, skillRow, rememberedRow, bubble] = orderOf(html, [
    'class="work-log"', 'Thích câu trả lời ngắn.', 'Quy ước hóa đơn', 'Open the Memory tab', 'invoice.xlsx', '>Searched the web<', 'references/invoices.md',
    'Remembered something for later chats.', `id="message-${artifactId}"`,
  ]);
  expect([trace, memoryRow, noteRow, link, readRow, webRow, skillRow, rememberedRow, bubble]).toEqual([trace, memoryRow, noteRow, link, readRow, webRow, skillRow, rememberedRow, bubble].sort((a, b) => a - b));
  // What was loaded folds into one row; the runner's own status lines are not actions and are not rows.
  expect(html).toContain('Used 1 memory · Loaded 1 note');
  expect(html.match(/<li class="work-row">/g)).toHaveLength(2 + 4);
  expect(html).not.toContain('Đang gọi model');
  // Real lists a screen reader can read, and a mark that names how each step ended.
  expect(html).toContain('<ol class="work-list work-steps" aria-label="What the orglet did">');
  expect(html).toContain('<details class="work-fold work-loaded"><summary class="activity-summary work-summary">');
  expect(html).toContain('role="img" aria-label="Done"');
});

it('keeps the work out of the chat unless the person shows it in Settings (user, 2026-10-06)', () => {
  const events = [eventOf(runId, 'Đã đọc invoice.xlsx'), eventOf(runId, 'Đã lưu câu trả lời.')];
  const hidden = renderThread([runOf(runId, worker, undefined, context)], events, answerOf([memory]), () => {}, false);
  expect(hidden).not.toContain('work-log');
  expect(hidden).not.toContain('class="turn-before"');
  expect(hidden).toContain(`id="message-${artifactId}"`);
  const live = renderToStaticMarkup(createElement(LiveRun, {
    update: { taskId, runId, startedAt: Date.now(), progress: { thinking: 'Đang cân nhắc.', preamble: '', answer: 'Hóa đơn', activity: [{ id: 's1', kind: 'read', target: 'invoice.xlsx', done: true }], writing: false } },
    memories: context.memories, showWork: false,
  }));
  expect(live).not.toContain('work-log');
  expect(live).not.toContain('activity-elapsed');
  expect(live).not.toContain('Đang cân nhắc.');
  expect(live).toContain('Hóa đơn');
});

it('renders nothing when the trace is empty', () => {
  const html = renderThread([runOf(runId, worker)], [eventOf(runId, 'Đã lưu câu trả lời.')], answerOf());
  expect(html).not.toContain('work-log');
  expect(html).not.toContain('class="turn-before"');
  expect(html).toContain(`id="message-${artifactId}"`);
});

it('invents no actions for a connection the core sees nothing of', () => {
  const cursor: Worker = { ...worker, provider: 'cursor' };
  const events = [eventOf(runId, 'Đang chạy Cursor Agent 1.0 trên máy · chỉ đọc bản sao nguồn của task'), eventOf(runId, 'Đã lưu câu trả lời.')];
  const html = renderThread([runOf(runId, cursor)], events, answerOf());
  expect(html).not.toContain('work-log');
  expect(traceOf({ runId, events })).toEqual([]);
});

it('marks a refusal as a quieter row and counts it as a step that did not go through', () => {
  const events = [eventOf(runId, 'Cảm xúc thứ 1 bị từ chối: tin nhắn không tồn tại.'), eventOf(runId, 'Không ghi nhớ được: Lượt chạy này không thuộc hội nào; ghi nhớ cho Tí hoặc toàn workspace.')];
  const entries = traceOf({ runId, events });
  expect(entries.map(entry => entry.kind)).toEqual(['failed', 'failed']);
  expect(traceSummary(entries)).toBe('2 steps did not go through');
  const html = renderToStaticMarkup(createElement(WorkLog, { entries }));
  expect(html.match(/class="work-row work-row-failed"/g)).toHaveLength(2);
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
  expect(traceSummary(traceOf({ runId, events }))).toBe('Read 1 file · Searched once · Listed files 2 times · Read 1 web page · Checked data once · Edited 1 file · Ran 1 command · Proposed 1 change');
});

it('counts web searches and web pages apart, so the folded line says what went online (dogfood, 2026-09-26)', () => {
  const search = 'Đã tìm kiếm web; kết quả chưa được xác minh.';
  const page = 'Đã đọc trang web dưới dạng dữ liệu không đáng tin.';
  const events = [search, page, page, search, page, page].map(message => eventOf(runId, message));
  // The same six steps used to read "Went online 6 times".
  expect(traceSummary(traceOf({ runId, events }))).toBe('Searched the web 2 times · Read 4 web pages');
  expect(traceSummary(traceOf({ runId, events: [eventOf(runId, page)] }))).toBe('Read 1 web page');
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
  const html = renderToStaticMarkup(createElement(WorkLog, { entries }));
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
  const html = renderToStaticMarkup(createElement(WorkLog, { entries }));
  expect(html).toContain('<span class="work-verb">Moved</span><span class="work-target">receipt 3.pdf → receipts/march.pdf</span>');
  expect(html).toContain('Could not move: notes.txt → contract-old.pdf');
});

it('reads the plain sentences the working copy now writes the same way as the older tool lines (COD-292)', () => {
  const events = [
    eventOf(runId, 'Đã đọc notes/plan.md'),
    eventOf(runId, 'Đã liệt kê tệp'),
    eventOf(runId, 'Đã tìm “deadline”'),
    eventOf(runId, 'Đã ghi trong bản làm việc: notes/plan.md'),
    eventOf(runId, 'Đã tạo thư mục trong bản làm việc: docs'),
    eventOf(runId, 'Đã chuyển trong bản làm việc: a.md → docs/a.md'),
    eventOf(runId, 'Đã xóa trong bản làm việc: old.md'),
  ];
  const entries = traceOf({ runId, events });
  expect(entries.map(entry => [entry.kind, entry.target])).toEqual([
    ['read', 'notes/plan.md'], ['list', undefined], ['search', '“deadline”'], ['edit', 'notes/plan.md'],
    ['folder', 'docs'], ['move', 'a.md → docs/a.md'], ['delete', 'old.md'],
  ]);
  expect(translateMessage(en, 'Đã tạo thư mục trong bản làm việc: docs')).toBe('Created a folder in the working copy: docs');
  expect(translateMessage(en, 'Đã chuyển trong bản làm việc: a.md → docs/a.md')).toBe('Moved in the working copy: a.md → docs/a.md');
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
  expect(html).toContain('Reassigned work to Writer: phần đầu chưa đủ.');
  expect(html).toContain('Handed off to</span><span class="work-target work-person">');
  const list = html.slice(html.indexOf('class="work-list work-steps"'), html.indexOf('</ol>'));
  const verb = list.indexOf('Handed off to');
  const row = list.slice(list.lastIndexOf('<li', verb), list.indexOf('</li>', verb));
  expect(row.indexOf('Handed off to')).toBeLessThan(row.indexOf('class="avatar xxs'));
  expect(row.indexOf('class="avatar xxs')).toBeLessThan(row.indexOf('Writer'));
});

it('keeps one work log while the answer streams, the memories first, an open step pulsing and the thinking on top', () => {
  const entries = liveTraceOf(context.memories, [{ id: 's1', kind: 'read', target: 'invoice.xlsx', done: true }, { id: 's2', kind: 'other', target: 'Bash', done: false }]);
  expect(entries.map(entry => [entry.kind, entry.running ?? false])).toEqual([['memory', false], ['read', false], ['other', true]]);
  const html = renderToStaticMarkup(createElement(LiveRun, {
    update: { taskId, runId, startedAt: Date.now(), progress: { thinking: 'Đang cân nhắc.', preamble: '', answer: 'Hóa đơn', activity: [{ id: 's1', kind: 'read', target: 'invoice.xlsx', done: true }, { id: 's2', kind: 'other', target: 'Bash', done: false }], writing: false } },
    memories: context.memories, showWork: true,
  }));
  expect(html.match(/class="work-log"/g)).toHaveLength(1);
  expect(html).toContain('Used 1 memory');
  expect(html).toContain('class="work-row running"');
  expect(html).toContain('aria-label="Running"');
  expect(html.indexOf('class="work-fold work-thinking"')).toBeLessThan(html.indexOf('class="work-fold work-loaded"'));
  // The tool's name is never shown; the timer and the notes sit after the rows.
  expect(html).not.toContain('Bash');
  expect(html.indexOf('class="work-list work-steps"')).toBeLessThan(html.indexOf('class="activity-elapsed"'));
  expect(html).toContain('Đang cân nhắc.');
});

it('shows the timer alone while a run has streamed nothing to trace', () => {
  const html = renderToStaticMarkup(createElement(LiveRun, {
    update: { taskId, runId, startedAt: Date.now(), progress: { thinking: '', preamble: '', answer: '', activity: [], writing: false } },
    showWork: true,
  }));
  expect(html).not.toContain('work-log');
  expect(html).toContain('activity-elapsed-plain');
});

it('says in the chat when an image was not shown to the orglet (COD-292)', () => {
  const events = [
    eventOf(runId, 'Đã đọc report.pdf'),
    eventOf(runId, 'Đã đọc sales.csv'),
    eventOf(runId, 'Tí không xem được ảnh photo.png: kết nối này không nhận ảnh.'),
  ];
  const entries = traceOf({ runId, events });
  expect(entries.map(entry => entry.kind)).toEqual(['read', 'read', 'withheld']);
  expect(traceSummary(entries)).toBe('Read 2 files · 1 image not shown to the orglet');
  const html = renderToStaticMarkup(createElement(WorkLog, { entries }));
  expect(html).toContain('work-row work-row-failed');
  expect(html).toContain('photo.png');
});

it('marks each step with a mark of its own shape and name: done, did not go through, running', () => {
  const entries = traceOf({ runId, events: [eventOf(runId, 'Đã đọc a.md'), eventOf(runId, 'Không ghi nhớ được: hết chỗ.')] });
  expect(entries.map(traceStatusOf)).toEqual(['done', 'failed']);
  expect(traceStatusOf({ id: 'x', kind: 'read', target: 'b.md', running: true })).toBe('running');
  const html = renderToStaticMarkup(createElement(WorkLog, { entries: [...entries, { id: 'x', kind: 'read', target: 'b.md', running: true }] }));
  expect(html).toContain('work-mark work-mark-done" role="img" aria-label="Done"');
  expect(html).toContain('work-mark work-mark-failed" role="img" aria-label="Did not go through"');
  expect(html).toContain('work-mark work-mark-running" role="img" aria-label="Running"');
  // A tick, a cross and a dot: the shapes differ, so colour is never the only signal.
  expect(html).toContain('lucide-check');
  expect(html).toContain('lucide-x');
  expect(html).toContain('class="work-dot"');
});

it('reads a command exit from the core sentence: zero is done, any other code, a timeout, a stop or too much output is not', () => {
  const status = (message: string) => traceStatusOf(traceOf({ runId, events: [eventOf(runId, message)] })[0]);
  expect(status('Đã chạy lệnh npm test · mã thoát 0')).toBe('done');
  expect(status('Đã chạy lệnh npm test · mã thoát 1')).toBe('failed');
  expect(status('Lệnh node build.js đã hết thời gian')).toBe('failed');
  expect(status('Đã dừng lệnh npm run dev')).toBe('failed');
  expect(status('Lệnh npm run lint in quá nhiều nên đã bị dừng')).toBe('failed');
  expect(status('Tiến trình đã dừng: exited, mã thoát 0')).toBe('done');
  expect(status('Tiến trình đã dừng: killed')).toBe('failed');
  // A sentence from before commands named their exit claims nothing.
  expect(status('Đã chạy lệnh npm test')).toBe('done');
});

it('shows the first 8 steps and a button for the rest', () => {
  const events = Array.from({ length: 11 }, (_, index) => eventOf(runId, 'Đã đọc file-' + index + '.md'));
  const html = renderToStaticMarkup(createElement(WorkLog, { entries: traceOf({ runId, events }) }));
  expect(html.match(/<li class="work-row">/g)).toHaveLength(8);
  expect(html).toContain('file-7.md');
  expect(html).not.toContain('file-8.md');
  expect(html).toContain('Show 3 more steps');
  const few = renderToStaticMarkup(createElement(WorkLog, { entries: traceOf({ runId, events: events.slice(0, 8) }) }));
  expect(few).not.toContain('more steps');
});

it('finds the diff file a step is about, the new place for a move', () => {
  const files = [{ path: 'src/a.ts' }, { path: 'docs/b.md', previousPath: 'b.md' }];
  expect(diffFileOf(files, { id: '1', kind: 'edit', target: 'src/a.ts' })).toBe(files[0]);
  expect(diffFileOf(files, { id: '2', kind: 'move', target: 'b.md → docs/b.md' })).toBe(files[1]);
  expect(diffFileOf(files, { id: '3', kind: 'edit', target: 'c.ts' })).toBeUndefined();
  expect(diffFileOf(files, { id: '4', kind: 'edit', target: 'app/src/a.ts' })).toBe(files[0]);
});

it('opens a changed file from the steps only when the run kept a working copy, and never draws thinking for a saved answer', () => {
  const entries = traceOf({ runId, events: [eventOf(runId, 'Đã ghi trong bản làm việc: src/a.ts'), eventOf(runId, 'Đã đọc src/a.ts')] });
  const withCopy = renderToStaticMarkup(createElement(WorkLog, { entries, diffRun: { taskId, runId } }));
  expect(withCopy.match(/<details class="work-edit"/g)).toHaveLength(1);
  const without = renderToStaticMarkup(createElement(WorkLog, { entries }));
  expect(without).not.toContain('work-edit');
  expect(without).not.toContain('work-thinking');
  expect(renderThread([runOf(runId, worker)], [eventOf(runId, 'Đã đọc a.md')], answerOf())).not.toContain('work-thinking');
});
