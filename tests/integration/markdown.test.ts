import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../../apps/desktop/src/renderer/components/Markdown';

function render(text: string) {
  return renderToStaticMarkup(createElement(Markdown, { text }));
}

it('renders emphasis, lists with continuation lines, headings and code', () => {
  const html = render([
    '**Who I am**: a *helpful* coworker with `code`.',
    '',
    '- First point',
    '- Second point',
    '',
    '### Three tasks',
    '',
    '1. **Review the deck.**',
    '   Paste it and I will check the claims.',
    '2. Sort feedback.',
  ].join('\n'));

  expect(html).toContain('<strong>Who I am</strong>');
  expect(html).toContain('<em>helpful</em>');
  expect(html).toContain('<code>code</code>');
  expect(html).toContain('<ul><li>First point</li><li>Second point</li></ul>');
  expect(html).toContain('<h4>Three tasks</h4>');
  expect(html).toContain('<ol start="1"><li><strong>Review the deck.</strong><br/>Paste it and I will check the claims.</li><li>Sort feedback.</li></ol>');
});

it('turns a thematic break into space instead of a line', () => {
  const html = render('Before\n\n---\n\nAfter');
  expect(html).toContain('<div class="markdown-break" aria-hidden="true"></div>');
  expect(html).not.toContain('<hr');
});

it('never passes HTML or link targets through as markup', () => {
  const html = render('<img src=x onerror="alert(1)"> and [site](javascript:alert(1))');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('href=');
  expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

it('keeps text inside code blocks literal', () => {
  const html = render('```\n**not bold**\n```');
  expect(html).toContain('<pre><code>**not bold**</code></pre>');
});

it('renders bold inside italic, as workers write suggested wording', () => {
  const html = render('Suggestion: *"Invoices are due within **7 days**."*');
  expect(html).toContain('<em>&quot;Invoices are due within <strong>7 days</strong>.&quot;</em>');
});
