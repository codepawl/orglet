import { expect, it } from 'vitest';
import { OutputTail, checkerStoppedMessage } from '../../apps/desktop/src/main/output-tail';
import { translateMessage } from '../../apps/desktop/src/shared/i18n';
import { en } from '../../apps/desktop/src/shared/locales/en';

// COD-292: the data checker's stderr used to be dropped, so a crash read like a cancel.
it('keeps only the last lines of a process\'s error output, with the scratch folder cut out', () => {
  const tail = new OutputTail();
  for (let line = 0; line < 5_000; line++) tail.add(`noise ${line}\n`);
  tail.add(Buffer.from('reading C:\\Temp\\orglet-profile-abc\\0.csv\n'));
  tail.add('Error: Out of Memory Error: failed to allocate 64 MB\r\n\r\n');
  const lines = tail.lastLines(['C:\\Temp\\orglet-profile-abc']);
  expect(lines).toBe('noise 4999 · reading …\\0.csv · Error: Out of Memory Error: failed to allocate 64 MB');
  expect(new OutputTail().lastLines()).toBe('');
});

it('says the checker crashed with what it printed, and keeps the plain stop when it printed nothing', () => {
  expect(checkerStoppedMessage('')).toBe('Checker đã dừng hoặc bị hủy. Không có kết quả được xác nhận.');
  const crashed = checkerStoppedMessage('Error: Out of Memory Error');
  expect(translateMessage(en, crashed)).toBe('The checker stopped partway with no result. The last error it printed: Error: Out of Memory Error');
});

it('never grows past a few hundred characters however long the last line is', () => {
  const tail = new OutputTail();
  tail.add(`${'x'.repeat(10_000)}\n`);
  expect(tail.lastLines().length).toBeLessThanOrEqual(401);
});
