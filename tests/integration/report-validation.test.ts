import { expect, it } from 'vitest';
import { reportValidationMessage } from '../../apps/desktop/src/core/tools/report-validation';
import { translateMessage } from '../../apps/desktop/src/shared/i18n';
import { en } from '../../apps/desktop/src/shared/locales/en';

const failureWith = (...issues: { path: string; code: string; expected?: string }[]) => ({ toolName: 'submit_report' as const, issues });

it('tells the person what was wrong with a report in plain words, never a schema path (COD-292)', () => {
  const unreadable = reportValidationMessage(failureWith({ path: 'arguments', code: 'invalid_json' }));
  const noOutcome = reportValidationMessage(failureWith({ path: 'assignmentOutcome', code: 'invalid_type', expected: 'completed or blocked' }));
  const incomplete = reportValidationMessage(failureWith({ path: 'summary', code: 'invalid_type', expected: 'string' }, { path: 'findings.0.title', code: 'too_small' }));
  for (const message of [unreadable, noOutcome, incomplete]) {
    expect(message).not.toMatch(/invalid_|too_small|summary|findings|assignmentOutcome|schema|completed|blocked/);
  }
  expect(translateMessage(en, noOutcome)).toBe('The orglet handed in a report without saying whether its part was done or blocked.');
  expect(translateMessage(en, unreadable)).toBe('The orglet handed in a report Orglet could not read.');
});

it('translates the report error whole, with the note the run adds after its one correction', () => {
  const message = reportValidationMessage(failureWith({ path: 'summary', code: 'invalid_type' }));
  expect(translateMessage(en, `${message} Đã hết một lần sửa báo cáo trong lượt này.`))
    .toBe('The orglet’s report left out something it needs or had a part in the wrong form. It already had its one chance to correct the report this turn.');
});
