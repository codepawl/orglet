import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chartCsv, chartProblemsIn, checkChart, echartsOption, histogramBins, type ChartTheme } from '../../apps/desktop/src/shared/charts';
import { DEMO_CHART_REPLY } from '../../apps/desktop/src/shared/demo-replies';
import { Markdown } from '../../apps/desktop/src/renderer/components/Markdown';

const theme: ChartTheme = { series: ['#111111', '#222222'], text: '#000000', muted: '#666666', grid: '#eeeeee', surface: '#ffffff', font: 'Inter' };
const revenue = { type: 'line', title: 'Revenue', takeaway: 'It grew.', columns: ['Month', 'Revenue'], rows: [['Jan', 10], ['Feb', 12]], x: 'Month', y: ['Revenue'] };

// Charts in the chat are a spec of Orglet's own, checked before they are drawn (in-chat charts, 2026-10-07).
it('accepts a valid chart and turns it into themed ECharts options with one value axis', () => {
  const checked = checkChart(JSON.stringify(revenue));
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  const option = echartsOption(checked.spec, theme) as { color: string[]; yAxis: { type: string }; series: { type: string; data: unknown[] }[]; dataZoom?: unknown[] };
  expect(option.color).toEqual(theme.series);
  expect(option.yAxis.type).toBe('value');
  expect(option.series).toEqual([expect.objectContaining({ type: 'line', data: [10, 12] })]);
  expect(option.dataZoom).toBeDefined();
});

it('says exactly what is wrong in a chart an orglet can fix', () => {
  expect(checkChart('{not json')).toEqual({ ok: false, problems: ['The chart is not valid JSON.'] });
  expect(checkChart({ ...revenue, y: ['Profit'] })).toEqual({ ok: false, problems: ['There is no column named "Profit".'] });
  expect(checkChart({ ...revenue, rows: [['Jan', '10k'], ['Feb', 12]] })).toMatchObject({ ok: false, problems: [expect.stringContaining('must hold numbers')] });
  expect(checkChart({ ...revenue, rows: [['Jan', 10, 3]] })).toMatchObject({ ok: false, problems: [expect.stringContaining('has 3 cells')] });
  expect(checkChart({ ...revenue, type: 'pie', rows: [['a', -1]] })).toMatchObject({ ok: false, problems: [expect.stringContaining('negative')] });
  expect(checkChart({ ...revenue, script: 'alert(1)' })).toMatchObject({ ok: false });
});

it('finds the broken charts in a reply, numbered in order', () => {
  const reply = ['Here:', '```chart', JSON.stringify(revenue), '```', 'and', '```chart', JSON.stringify({ ...revenue, x: 'Day' }), '```'].join('\n');
  expect(chartProblemsIn(reply)).toEqual(['Chart 2: There is no column named "Day".']);
  expect(chartProblemsIn(DEMO_CHART_REPLY)).toEqual([]);
});

it('bins a histogram, and writes the data as CSV', () => {
  expect(histogramBins([1, 2, 2, 9, null, 'x'], 2)).toEqual([{ label: '1–5', count: 3 }, { label: '5–9', count: 1 }]);
  expect(chartCsv({ ...revenue, rows: [['Jan, early', 10], ['Feb', null]] } as never)).toBe('Month,Revenue\n"Jan, early",10\nFeb,');
});

it('renders a chart fence as a chart, never as code, in a reply', () => {
  const html = renderToStaticMarkup(createElement(Markdown, { text: DEMO_CHART_REPLY }));
  expect(html).not.toContain('<pre><code>{');
  expect(html).toContain('Revenue grew every month');
});
