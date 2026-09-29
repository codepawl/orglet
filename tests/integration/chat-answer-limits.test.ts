import { expect, it } from 'vitest';
import { z } from 'zod';
import { ChatMessage, MAX_CHAT_MESSAGE_CHARACTERS, Report } from '../../apps/desktop/src/shared/contracts';
import { ChatReply, HarnessAnswer, HarnessAnswerSchema, ModelReport } from '../../apps/desktop/src/core/tools/catalog';
import { outputSchema } from '../../apps/desktop/src/core/skill-package';

const document = 'x'.repeat(MAX_CHAT_MESSAGE_CHARACTERS);
const report = { title: 'Document', summary: document, findings: [], limitations: [] };

it('shares a bounded message contract between native replies, harnesses and saved chats', () => {
  expect(ChatMessage.parse(document)).toBe(document);
  expect(ChatReply.parse({ message: document }).message).toBe(document);
  expect(HarnessAnswer.parse({ message: document, report: null }).message).toBe(document);
  expect(HarnessAnswerSchema.parse({ message: document, title: null, report: null }).message).toBe(document);
  expect(Report.parse({ ...report, format: 'chat' }).summary).toBe(document);
  const overLimit = `${document}x`;
  expect(ChatReply.safeParse({ message: overLimit }).success).toBe(false);
  expect(HarnessAnswer.safeParse({ message: overLimit, report: null }).success).toBe(false);
  expect(Report.safeParse({ ...report, format: 'chat', summary: overLimit }).success).toBe(false);
  expect((z.toJSONSchema(HarnessAnswerSchema).properties?.message as { maxLength: number }).maxLength).toBe(MAX_CHAT_MESSAGE_CHARACTERS);
});

it('keeps structured reports and old artifacts at their existing summary limit', () => {
  const summary = 'x'.repeat(16_000);
  expect(Report.parse({ ...report, summary }).summary).toBe(summary);
  expect(Report.parse({ ...report, format: 'report', summary }).summary).toBe(summary);
  for (const format of [undefined, 'report']) {
    expect(Report.safeParse({ ...report, format, summary: `${summary}x` }).success).toBe(false);
  }
  expect(ModelReport.safeParse({ ...report, format: 'chat', summary: `${summary}x` }).success).toBe(false);
  expect((outputSchema.properties?.summary as { maxLength: number }).maxLength).toBe(16_000);
});

it('does not let the chat format bypass validation of report fields', () => {
  expect(Report.safeParse({ ...report, format: 'chat', findings: [{ title: 'Missing evidence fields' }] }).success).toBe(false);
  expect(Report.safeParse({ ...report, format: 'chat', review: { checks: [] } }).success).toBe(false);
});
