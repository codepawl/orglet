/** A source as an answer can mention it: the id the model was given and the name the person knows it by. */
export type MentionedSource = { id: string; name: string };

const escapeForPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * An answer as the person should read it: a source id the model copied from its manifest reads as the file's name
 * (COD-257). A Codex reply ended with "Source: metrics.csv (49843085-f660-…)". After the file's own name the id in
 * brackets is dropped; anywhere else the id is replaced by the name. Only ids of the chat's own sources are touched,
 * so any other text, ids included, stays as the model wrote it. The structured citations of a report are separate
 * fields and are not affected.
 */
export function withoutSourceIds(text: string, sources: readonly MentionedSource[]): string {
  let readable = text;
  for (const source of sources) {
    const id = escapeForPattern(source.id);
    const label = '(?:source\\s*id|sourceid|id)\\s*[:=]?\\s*';
    const bracketedId = `[ \\t]*[(\\[]\`?(?:${label})?${id}\`?[)\\]]`;
    // "metrics.csv (id)", also with the name in code or bold: the name already says which file.
    const afterName = new RegExp(`(${escapeForPattern(source.name)}[\`*_]*)${bracketedId}`, 'gi');
    readable = readable.replace(afterName, (_match, name: string) => name);
    const anywhere = new RegExp(`\`?${id}\`?`, 'gi');
    // A function, so a "$" in a file name is taken as written rather than as a replacement pattern.
    readable = readable.replace(anywhere, () => source.name);
  }
  return readable;
}
