import { Fragment } from 'react';
import { parseMentions, type MentionPerson } from '../../shared/mentions';
import { LinkedText, Markdown } from './Markdown';

/** A person's message as Markdown (bold, lists, code, links), with its `@name` tags highlighted wherever they sit. */
export function MentionMarkdown({ text, people, allNames }: { text: string; people: readonly MentionPerson[]; allNames?: readonly string[] }) {
  return <Markdown text={text} plainText={part => <MentionText text={part} people={people} allNames={allNames} />} />;
}

/** Highlights `@name` tags in a user message and makes its web addresses links. Unknown `@` text stays plain. */
export function MentionText({ text, people, allNames }: { text: string; people: readonly MentionPerson[]; allNames?: readonly string[] }) {
  const hits = parseMentions(text, people, allNames);
  if (!hits.length) return <LinkedText text={text} />;
  const nodes = [];
  let position = 0;
  for (const hit of hits) {
    if (hit.start > position) nodes.push(<LinkedText text={text.slice(position, hit.start)} />);
    nodes.push(<span key={hit.start} className="mention">@{hit.name}</span>);
    position = hit.end;
  }
  if (position < text.length) nodes.push(<LinkedText text={text.slice(position)} />);
  return <>{nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>)}</>;
}
