import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { format, translate, translateMessage } from '../../apps/desktop/src/shared/i18n';
import { en, enGB } from '../../apps/desktop/src/shared/locales/en';

const placeholders = (text: string) => [...text.matchAll(/\{(\d+)\}/g)].map(match => match[1]).sort().join(',');

it('keeps every placeholder of the Vietnamese key in its English text', () => {
  const broken = Object.entries(en).filter(([key, value]) => placeholders(key) !== placeholders(value));
  expect(broken).toEqual([]);
  expect(Object.entries(en).filter(([key, value]) => key.trim() && !value.trim())).toEqual([]);
});

it('translates keys with parameters and leaves unknown text unchanged', () => {
  expect(translate(null, 'Màu {0}', ['#fff'])).toBe('Màu #fff');
  expect(translate(en, 'Màu {0}', ['#fff'])).toBe('Color #fff');
  expect(translate(en, 'Model output that is not a key')).toBe('Model output that is not a key');
  expect(format('{1} / {0}', ['a', 'b'])).toBe('b / a');
});

it('translates finished core messages, including ones with values already filled in', () => {
  expect(translateMessage(null, 'Không tìm thấy công việc.')).toBe('Không tìm thấy công việc.');
  expect(translateMessage(en, 'Không tìm thấy công việc.')).toBe('Task not found.');
  expect(translateMessage(en, 'Run-log dòng 12: completed cần score hợp lệ.')).toBe('Run log row 12: completed rows need a valid score.');
  expect(translateMessage(en, 'Bản sao lưu không hợp lệ: Nhóm thiếu nhân viên.')).toBe('Invalid backup: Nhóm thiếu nhân viên.');
  expect(translateMessage(en, 'Something the core never says.')).toBe('Something the core never says.');
});

it('derives British English spellings from the US text', () => {
  expect(enGB['Tóm tắt tài liệu đã đính kèm']).toBe('Summarise the attached documents');
  expect(en['Tóm tắt tài liệu đã đính kèm']).toBe('Summarize the attached documents');
  expect(enGB['Song song, rồi tổng hợp']).toBe('In parallel, then combine');
  expect(enGB['Giấy phép: {0}']).toBe('Licence: {0}');
  // Words that merely contain the letters stay untouched.
  expect(enGB['Tệp vượt giới hạn kích thước.']).toBe('The file exceeds the size limit.');
  expect(Object.keys(enGB)).toEqual(Object.keys(en));
});

it('has English text for every Vietnamese UI key in the source tree', () => {
  const result = spawnSync(process.execPath, [join(__dirname, '..', '..', 'scripts', 'i18n-keys.cjs')], { encoding: 'utf8' });
  expect(result.stderr).toMatch(/0 missing/);
  expect(JSON.parse(result.stdout)).toEqual([]);
});
