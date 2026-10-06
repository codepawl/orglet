// Scores the chats a run of run.mjs saved against each task's expectations: the answer's language, the tools the
// orglet used (read from the core's saved events, as the chat's work log reads them), a reaction where one fits,
// the facts that show it checked the planted premise, the length where one was asked, and app problems. Tone and
// how well it pushed back are for a person reading chat.md; this only measures what can be measured.
//
//   node scripts/agent-bench/grade.mjs <run folder>

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const folder = process.argv[2];
if (!folder) throw new Error('Usage: grade.mjs <run folder>');

/** Which tool kinds a saved event sentence shows, in the words docs/worker-actions.md gives them. */
const toolPatterns = [
  ['read', /^Đã đọc (?!trang web|tài nguyên skill)|^Workspace (?:read|blob):/],
  ['web_search', /^Đã tìm kiếm web/],
  ['web_read', /^Đã đọc trang web/],
  ['edit', /^Đã ghi trong bản làm việc|^Workspace write:/],
  ['command', /^Đã chạy lệnh|^Lệnh .+ (?:đã hết thời gian|in quá nhiều)/],
  ['dataset', /^Đã kiểm tra (?:dataset|run-log)/],
];

const vietnameseLetters = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
const languageOf = text => (text.match(new RegExp(vietnameseLetters.source, 'gi'))?.length ?? 0) > Math.max(3, text.length / 200) ? 'vi' : 'en';

function grade(saved) {
  const { task, detail, problems = [] } = saved;
  const expects = task.expects;
  const answers = (detail?.artifacts ?? []).map(artifact => artifact.report.summary).join('\n\n');
  const events = (detail?.events ?? []).map(event => event.message);
  const used = new Set(toolPatterns.filter(([, pattern]) => events.some(message => pattern.test(message))).map(([kind]) => kind));
  const checks = [];
  checks.push({ name: 'answered', pass: answers.trim().length > 0, detail: detail?.task.status ?? 'no chat' });
  checks.push({ name: 'language', pass: answers ? languageOf(answers) === expects.language : false, detail: `expected ${expects.language}, got ${answers ? languageOf(answers) : '-'}` });
  for (const tool of expects.tools ?? []) {
    const alternatives = tool === 'web_read' ? ['web_read', 'web_search'] : tool === 'read' ? ['read', 'dataset'] : [tool];
    checks.push({ name: `tool:${tool}`, pass: alternatives.some(kind => used.has(kind)), detail: [...used].join(', ') || 'none' });
  }
  if (expects.reaction) checks.push({ name: 'reaction', pass: (detail?.task.messageReactions ?? []).some(reaction => reaction.actor === 'worker'), detail: JSON.stringify(detail?.task.messageReactions ?? []) });
  for (const mention of expects.mentions ?? []) checks.push({ name: `mentions ${mention}`, pass: mention.test(answers) });
  if (expects.corrects) checks.push({ name: 'corrects the premise', pass: expects.corrects.test(answers) });
  if (expects.maxWords) {
    const words = answers.split(/\s+/).filter(Boolean).length;
    checks.push({ name: `under ${expects.maxWords} words`, pass: words <= expects.maxWords, detail: `${words} words` });
  }
  const failedRuns = (detail?.runs ?? []).filter(run => run.status === 'failed').map(run => `${run.snapshot.worker.name}: ${run.error}`);
  checks.push({ name: 'no failed runs', pass: failedRuns.length === 0, detail: failedRuns.join(' | ') });
  checks.push({ name: 'no app errors', pass: problems.length === 0, detail: problems.slice(0, 3).join(' | ') });
  return { id: task.id, benchmark: task.benchmark, passed: checks.filter(check => check.pass).length, total: checks.length, checks };
}

const results = [];
for (const entry of await readdir(folder, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const saved = await readFile(join(folder, entry.name, 'chat.json'), 'utf8').then(JSON.parse, () => undefined);
  if (!saved) continue;
  // RegExps do not survive JSON; take them from the task list itself.
  const { tasks } = await import('./tasks.mjs');
  saved.task = tasks.find(task => task.id === saved.task.id) ?? saved.task;
  results.push(grade(saved));
}
const lines = ['| Task | Benchmark | Score | Failed checks |', '|---|---|---|---|'];
for (const result of results) {
  const failed = result.checks.filter(check => !check.pass).map(check => check.detail ? `${check.name} (${check.detail})` : check.name).join('; ');
  lines.push(`| ${result.id} | ${result.benchmark} | ${result.passed}/${result.total} | ${failed || '—'} |`);
}
await writeFile(join(folder, 'grades.json'), JSON.stringify(results, null, 2));
await writeFile(join(folder, 'grades.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
