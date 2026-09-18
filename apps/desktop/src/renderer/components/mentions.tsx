import { Fragment } from 'react';
import { parseMentions, type MentionPerson } from '../../shared/mentions';

/** Highlights `@name` tags in a user message. Unknown `@` text stays plain. */
export function MentionText({ text, people, allNames }: { text: string; people: readonly MentionPerson[]; allNames?: readonly string[] }) {
  const hits = parseMentions(text, people, allNames);
  if (!hits.length) return <>{text}</>;
  const nodes = [];
  let position = 0;
  for (const hit of hits) {
    if (hit.start > position) nodes.push(text.slice(position, hit.start));
    nodes.push(<span key={hit.start} className="mention">@{hit.name}</span>);
    position = hit.end;
  }
  if (position < text.length) nodes.push(text.slice(position));
  return <>{nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>)}</>;
}
