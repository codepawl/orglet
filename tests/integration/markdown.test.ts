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

it('turns web addresses into links that open in the browser, and names the site of a link dressed as another', () => {
  const html = render('See [the docs](https://docs.example.com/start) or https://example.org/a_b?x=1. Mail [us](mailto:team@example.com).');
  expect(html).toContain('<a class="markdown-link" href="https://docs.example.com/start">the docs<span class="markdown-link-address"> · docs.example.com</span></a>');
  // A bare address keeps its own text, without the sentence's full stop.
  expect(html).toContain('<a class="markdown-link" href="https://example.org/a_b?x=1">https://example.org/a_b?x=1</a>.');
  expect(html).toContain('href="mailto:team@example.com"');
});

it('keeps file paths, scripts and addresses hiding a sign-in as text', () => {
  const html = render('[open](file:///C:/Windows/system32) [bank](https://bank.example@evil.example/) [run](javascript:alert(1))');
  expect(html).not.toContain('href=');
  expect(html).toContain('(file:///C:/Windows/system32)');
});

it('keeps text inside code blocks literal', () => {
  const html = render('```\n**not bold**\n```');
  expect(html).toContain('<pre><code>**not bold**</code></pre>');
});

it('renders bold inside italic, as workers write suggested wording', () => {
  const html = render('Suggestion: *"Invoices are due within **7 days**."*');
  expect(html).toContain('<em>&quot;Invoices are due within <strong>7 days</strong>.&quot;</em>');
});

it('renders worker Markdown tables as safe, aligned cells', () => {
  const html = render([
    'Sales summary:',
    '| Item | Sales | Notes |',
    '| :--- | ---: | :---: |',
    '| Notebook | **240,000 VND** | `12 | 20k` |',
    '| Pen | 180,000 VND | A\\|B <script>alert(1)</script> |',
    '',
    'Net after booth: 121,000 VND.',
  ].join('\n'));

  expect(html).toContain('<p>Sales summary:</p><div class="markdown-table-wrap"><table>');
  expect(html).toContain('<th scope="col" style="text-align:right">Sales</th>');
  expect(html).toContain('<th scope="col" style="text-align:center">Notes</th>');
  expect(html).toContain('<td style="text-align:right"><strong>240,000 VND</strong></td>');
  expect(html).toContain('<code>12 | 20k</code>');
  expect(html).toContain('A|B &lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).toContain('</table></div><p>Net after booth: 121,000 VND.</p>');
  expect(html).not.toContain('<script>');
});

it('keeps pipe-separated prose without a table divider as prose', () => {
  const html = render('Options: red | blue\nStill one paragraph.');
  expect(html).toContain('<p>Options: red | blue<br/>Still one paragraph.</p>');
  expect(html).not.toContain('<table>');
});

it("renders a person's message as Markdown and keeps its @tags inside the marks", async () => {
  const { MentionMarkdown } = await import('../../apps/desktop/src/renderer/components/mentions');
  const people = [{ id: 'worker-1', name: 'Researcher' }];
  const html = renderToStaticMarkup(createElement(MentionMarkdown, { text: '**Ask @Researcher** about it\n\n- @Researcher first', people }));
  expect(html).toContain('<strong>Ask <span class="mention">@Researcher</span></strong> about it');
  expect(html).toContain('<li><span class="mention">@Researcher</span> first</li>');
});
