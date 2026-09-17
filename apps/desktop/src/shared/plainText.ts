/**
 * Plain text for pasting where Markdown would show as symbols: keeps the words, list order and link targets, and drops
 * heading marks, emphasis, code fences and quote marks.
 */
export function markdownToPlain(markdown: string) {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, url: string) => url.startsWith('#') ? text : `${text} (${url})`)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/gm, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^([ \t]*)[-*+]\s+/gm, '$1• ')
    .replace(/^\s*([-*_]\s*){3,}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
