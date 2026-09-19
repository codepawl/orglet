import { expect, it } from 'vitest';
import { insertMention, mentionOptions, mentionQueryAt, mentionedPeople, parseMentions } from '../../apps/desktop/src/shared/mentions';

const people = [
  { id: 'a', name: 'Researcher' },
  { id: 'b', name: 'Kế toán' },
  { id: 'c', name: 'Source researcher' },
];

it('parses @name tags, longest name first, and ignores emails', () => {
  const hits = parseMentions('Hi @Researcher and @Kế toán — also hello@example.com and @Source researcher please.', people);
  expect(hits.map(hit => hit.id)).toEqual(['a', 'b', 'c']);
  expect(hits[2]).toMatchObject({ name: 'Source researcher', start: 57 });
});

it('treats @all, @everyone, @tất cả and the team name as everyone', () => {
  expect(mentionedPeople('@all check this', people)).toBeUndefined();
  expect(mentionedPeople('@everyone', people)).toBeUndefined();
  expect(mentionedPeople('@tất cả', people)).toBeUndefined();
  expect(mentionedPeople('@Research Review look', people, ['Research Review'])).toBeUndefined();
});

it('returns tagged workers in roster order and ignores unknown tags', () => {
  expect(mentionedPeople('@Kế toán then @missing then @Researcher', people)?.map(person => person.id)).toEqual(['a', 'b']);
  expect(mentionedPeople('no tags here', people)).toBeUndefined();
  expect(mentionedPeople('@nobody', people)).toBeUndefined();
});

it('reads the @query at the cursor and inserts a chosen name', () => {
  const text = 'Ask @Ke';
  expect(mentionQueryAt(text, text.length)).toEqual({ start: 4, query: 'Ke' });
  expect(mentionQueryAt('Ask @Kế toán more', 3)).toBeUndefined();
  expect(insertMention(text, text.length, 'Kế toán')).toEqual({ text: 'Ask @Kế toán ', cursor: 13 });
});

it('filters picker options including @all and a team name', () => {
  // The team's own name is not offered: it means what @all means, so two entries would do the same thing.
  expect(mentionOptions('', people).map(option => option.name)).toEqual(['all', 'Researcher', 'Kế toán', 'Source researcher']);
  expect(mentionOptions('source', people).map(option => option.name)).toEqual(['Source researcher']);
  expect(mentionOptions('al', people).map(option => option.name)).toEqual(['all']);
});
