import { expect, it } from 'vitest';
import { skillSummary } from '../../apps/desktop/src/shared/skill-summary';

it('prefers the frontmatter description of an imported skill', () => {
  const content = '---\nname: evidence-review\ndescription: "Check every claim against the attached sources."\n---\n# Evidence review\n\nLong instructions follow.';
  expect(skillSummary(content)).toBe('Check every claim against the attached sources.');
});

it('falls back to the first paragraph, skipping headings', () => {
  const content = '# General help\n\nHelp with whatever the user asks.\nRead the sources first.\n\nSecond paragraph.';
  expect(skillSummary(content)).toBe('Help with whatever the user asks. Read the sources first.');
});

it('says nothing rather than something wrong when there is no prose', () => {
  expect(skillSummary('# Only a heading')).toBe('');
});
