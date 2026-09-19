import { expect, it } from 'vitest';
import { suggestStarters } from '../../apps/desktop/src/shared/starters';
import type { Skill, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';

const worker = (over: Partial<Worker> & { id: string; name: string }): Worker => ({
  instructions: 'Làm theo yêu cầu.', provider: 'demo', skillId: 'skill-general', revision: 1, ...over,
});
const skill = (id: string, name: string): Skill => ({ id, name, content: 'Nội dung skill.', revision: 1 });
const task = (over: Partial<Task> & { id: string; brief: string }): Task => ({
  workerId: 'w1', status: 'completed', createdAt: '2026-09-19T00:00:00.000Z', budgetMicros: 1000,
  sourceIds: [], consent: true, accepted: true, ...over,
});
const team = (over: Partial<Team> & { id: string; name: string }): Team => ({
  instructions: 'Hội làm việc cùng nhau.', memberIds: ['w1'], synthesizerId: 'w1', workflow: 'sequential',
  monthlyBudgetMicros: 100_000, revision: 1, ...over,
});

const ids = (starters: { id: string }[]) => starters.map(starter => starter.id);

it('gives two workers with different roles different starters', () => {
  const researcher = worker({ id: 'w1', name: 'Source researcher', description: 'Tra cứu và kiểm chứng nguồn' });
  const writer = worker({ id: 'w2', name: 'Release notes writer', description: 'Viết changelog cho mỗi bản phát hành' });
  const research = ids(suggestStarters({ worker: researcher }));
  const writing = ids(suggestStarters({ worker: writer }));
  expect(research[0]).toBe('research-landscape');
  expect(writing[0]).toBe('write-draft');
  expect(research).not.toEqual(writing);
});

it('reads the role from the skill name and the instructions, not only the worker name', () => {
  const auditor = worker({ id: 'w1', name: 'Minh', skillId: 'skill-review', instructions: 'Kiểm tra chất lượng và chấm điểm bài nộp.' });
  expect(ids(suggestStarters({ worker: auditor, skills: [skill('skill-review', 'Review có bằng chứng')] }))).toContain('review-secondopinion');
});

it('leads with the name when the name and the instructions point at different roles', () => {
  // The name is what a person writes on purpose; long instructions only nudge.
  const analyst = worker({ id: 'w1', name: 'Data analyst', instructions: 'Khi cần thì viết bài blog giới thiệu kết quả.' });
  const starters = ids(suggestStarters({ worker: analyst }));
  expect(starters.indexOf('data-question')).toBeLessThan(starters.indexOf('write-draft'));
});

it('offers a starter that reads attachments only while something is attached', () => {
  const reviewer = worker({ id: 'w1', name: 'Evidence reviewer', description: 'Review có bằng chứng' });
  expect(ids(suggestStarters({ worker: reviewer, hasSources: false }))).not.toContain('review-evidence');
  expect(ids(suggestStarters({ worker: reviewer, hasSources: true }))).toContain('review-evidence');
});

it('offers a brief this chat has repeated, in the person\'s own words', () => {
  const weekly = 'Tổng hợp tin tức tuần này cho mình';
  const tasks = [
    task({ id: 't1', brief: weekly }),
    task({ id: 't2', brief: weekly }),
    task({ id: 't3', brief: 'Một câu hỏi lẻ không lặp lại' }),
  ];
  const starters = suggestStarters({ worker: worker({ id: 'w1', name: 'Researcher' }), tasks });
  expect(starters[0]).toMatchObject({ id: 'history-0', label: weekly, prompt: weekly, ownWords: true });
  // A one-off message is not an opener.
  expect(starters.map(starter => starter.prompt)).not.toContain('Một câu hỏi lẻ không lặp lại');
});

it('counts a repeated brief through spacing, case and diacritics, and skips deleted tasks', () => {
  const tasks = [
    task({ id: 't1', brief: 'Tóm tắt  báo cáo tuần' }),
    task({ id: 't2', brief: 'tom tat bao cao tuan' }),
    task({ id: 't3', brief: 'Việc đã xóa', deletedAt: '2026-09-19T00:00:00.000Z' }),
    task({ id: 't4', brief: 'Việc đã xóa', deletedAt: '2026-09-19T00:00:00.000Z' }),
  ];
  const starters = suggestStarters({ worker: worker({ id: 'w1', name: 'Researcher' }), tasks });
  expect(starters[0].label).toBe('Tóm tắt báo cáo tuần');
  expect(starters.map(starter => starter.prompt)).not.toContain('Việc đã xóa');
});

it('shortens a long repeated brief for the row but keeps it whole in the composer', () => {
  const long = `Đọc lại toàn bộ tài liệu trong thư mục rồi viết cho mình một bản tóm tắt ${'thật '.repeat(10)}đầy đủ`;
  const tasks = [task({ id: 't1', brief: long }), task({ id: 't2', brief: long })];
  const [starter] = suggestStarters({ worker: worker({ id: 'w1', name: 'Researcher' }), tasks });
  expect(starter.label.length).toBeLessThan(long.length);
  expect(starter.label.endsWith('…')).toBe(true);
  expect(starter.prompt).toBe(long);
});

it('opens a team chat on the team and draws on what the members do', () => {
  const members = [
    worker({ id: 'w1', name: 'Source researcher', description: 'Tra cứu nguồn' }),
    worker({ id: 'w2', name: 'Evidence reviewer', description: 'Kiểm tra bằng chứng' }),
  ];
  const starters = ids(suggestStarters({ team: team({ id: 'team-1', name: 'Research Review', memberIds: ['w1', 'w2'] }), members }));
  expect(starters[0]).toBe('team-split');
  expect(starters).toContain('research-landscape');
  expect(starters).toContain('review-secondopinion');
});

it('still offers something for a worker whose role matches nothing', () => {
  const starters = ids(suggestStarters({ worker: worker({ id: 'w1', name: 'Minh', instructions: 'Trả lời ngắn gọn.' }) }));
  expect(starters).toEqual(['generic-ask', 'generic-steps']);
});

it('never repeats a starter and never returns more than the limit', () => {
  const analyst = worker({ id: 'w1', name: 'Data review analyst', description: 'Phân tích số liệu và review kết quả' });
  const repeated = 'Chạy báo cáo tuần';
  const tasks = [task({ id: 't1', brief: repeated }), task({ id: 't2', brief: repeated })];
  const starters = suggestStarters({ worker: analyst, tasks, hasSources: true });
  expect(starters).toHaveLength(4);
  expect(new Set(ids(starters)).size).toBe(starters.length);
  expect(ids(suggestStarters({ worker: analyst, limit: 2 }))).toHaveLength(2);
});
