import { expect, it } from 'vitest';
import { autoMascot, mascotCategoryIds, mascotColors, rankMascots, suggestMascots, suggestedColors, suggestedMascots } from '../../apps/desktop/src/renderer/components/mascotSuggest';

const all = Object.values(mascotCategoryIds).flat();
const top = (name: string, description?: string) => suggestMascots({ name, description })[0];

it('suggests mascots from Vietnamese and English roles', () => {
  expect(top('Researcher')).toBe('search');
  expect(top('Kế toán trưởng')).toBe('finance');
  expect(top('Nhân viên chăm sóc khách hàng')).toBe('headset');
  expect(top('Lập trình viên backend')).toBe('coder');
  expect(top('Trợ lý', 'Sắp xếp lịch họp cho sếp')).toBe('calendar');
  expect(top('Data analyst')).toBe('chart');
  expect(top('Chuyên viên tuyển dụng')).toBe('care');
});

it('matches whole words, with prefixes only for longer stems', () => {
  expect(suggestMascots({ name: 'Latest news' })).not.toContain('checker');
  expect(top('Chất lượng')).toBe('checker');
  expect(suggestMascots({ name: 'Lịch sử công ty' })).not.toContain('calendar');
  expect(suggestMascots({ name: 'Hợp đồng' })[0]).toBe('briefcase');
});

it('weights the name above the description and instructions, and one field cannot stack a keyword', () => {
  expect(top('Writer', 'reviews drafts')).toBe('writer');
  expect(suggestMascots({ name: 'Minh', instructions: 'Review the evidence carefully.' })[0]).toBe('checker');
  const repeated = rankMascots({ name: 'audit audit audit' }).find(item => item.id === 'checker')!.score;
  expect(repeated).toBe(rankMascots({ name: 'audit' }).find(item => item.id === 'checker')!.score);
  expect(suggestMascots({ name: 'Minh', skill: 'Payroll' })[0]).toBe('finance');
});

it('always offers suggestions, pushes back mascots other workers use, and keeps the automatic face stable', () => {
  expect(suggestMascots({ name: 'Zed' })).toEqual([]);
  expect(suggestedMascots({ name: 'Zed' })).toHaveLength(7);
  expect(suggestedMascots({ name: 'Researcher' })[0]).toBe('search');
  expect(suggestedMascots({ name: 'Researcher' }, { taken: ['search'] })[0]).toBe('focused');
  expect(suggestedMascots({ name: 'Zed' }, { taken: ['tie'] })[0]).toBe('briefcase');
  expect(autoMascot(all, 'w1', { name: 'Zed' })).toBe(autoMascot(all, 'w1', { name: 'Zed' }));
  expect(autoMascot(all, 'w1', { name: 'Researcher' })).toBe('search');
});

it('lists every mascot in exactly one category', () => {
  expect(new Set(all).size).toBe(all.length);
  expect(all.length).toBe(29);
});

it('suggests three colours led by the colour of the face shown', () => {
  const colors = suggestedColors('finance', 'w1', { name: 'Kế toán trưởng' });
  expect(colors).toHaveLength(3);
  expect(colors[0]).toBe(mascotColors.finance);
  expect(new Set(colors).size).toBe(3);
  expect(suggestedColors('classic', 'w1', { name: 'Zed' })[0]).toBe(mascotColors.classic);
  expect(Object.keys(mascotColors).sort()).toEqual([...all].sort());
});
