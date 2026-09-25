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
  expect(translateMessage(en, 'Bản sao lưu không hợp lệ: Hội thiếu Tí.')).toBe('Invalid backup: The crew is missing orglets.');
  expect(translateMessage(en, 'Something the core never says.')).toBe('Something the core never says.');
  // A message with its own key is not answered by the general "{0}: {1}" one (COD-246).
  expect(translateMessage(en, 'Không có Tí hay hội nào tên "Nobody". Có: Researcher.')).toBe('No orglet or crew is named "Nobody". Available: Researcher.');
  // The error that stopped a crew role is a message of its own inside the limitation, translated like one (COD-252).
  expect(translateMessage(en, 'Role chưa hoàn tất: Researcher: Chưa thể khuyến nghị sẵn sàng khi còn check thiếu/lỗi, bất đồng hoặc finding nghiêm trọng.'))
    .toBe('Unfinished roles: Researcher: Cannot recommend ready while checks are missing or failed, disagreements remain, or critical findings exist.');
  // Other values are not: a model's Vietnamese answer that merely has a label after a colon stays as written.
  expect(translateMessage(en, 'Bước 1: Mở terminal và chạy lệnh cài đặt.')).toBe('Bước 1: Mở terminal và chạy lệnh cài đặt.');
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

it('keeps the US English text free of the British spellings it derives', () => {
  // `en` is the US English source and `en-GB` is derived from it one way, so a British spelling written into
  // the US text reaches US readers and nothing downstream can undo it. Only the spellings the derivation
  // table in locales/en.ts produces are listed: "analysis" and "synthesis" are US English too, so they stay.
  const britishOnly = /\b(colour|licence|catalogue|customis|summaris|analys(e|ing))/i;
  expect(Object.entries(en).filter(([, text]) => britishOnly.test(text))).toEqual([]);
});

it('has English text for every Vietnamese UI key in the source tree', () => {
  const result = spawnSync(process.execPath, [join(__dirname, '..', '..', 'scripts', 'i18n-keys.cjs')], { encoding: 'utf8' });
  expect(result.stderr).toMatch(/0 missing/);
  expect(JSON.parse(result.stdout)).toEqual([]);
});
