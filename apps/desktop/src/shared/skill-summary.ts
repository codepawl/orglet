/**
 * One line saying what a skill does, for a list. An imported SKILL.md declares it in its frontmatter
 * `description`; a skill written in the app has none, so the first paragraph of its instructions stands in.
 */
export function skillSummary(content: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (frontmatter) {
    const description = /^description:\s*(.+)$/m.exec(frontmatter[1]);
    if (description) return collapse(unquote(description[1]));
  }
  const body = frontmatter ? content.slice(frontmatter[0].length) : content;
  const paragraph = body.split(/\r?\n\s*\r?\n/)
    .map(block => block.split(/\r?\n/).filter(line => !/^\s*#/.test(line)).join(' '))
    .find(block => block.trim().length > 0);
  return paragraph ? collapse(paragraph) : '';
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const unquote = (text: string) => text.trim().replace(/^(["'])(.*)\1$/, '$2');
