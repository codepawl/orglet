import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chartCsv, chartPointOf, chartProblemsIn, checkChart, echartsOption, histogramBins, type ChartTheme } from '../../apps/desktop/src/shared/charts';
import { DEMO_CHART_REPLY } from '../../apps/desktop/src/shared/demo-replies';
import { chartPointQuote } from '../../apps/desktop/src/renderer/chartPoint';
import { chartsOfChat } from '../../apps/desktop/src/renderer/chatViews';
import { clearReplyTarget, currentReplyTarget, replyToChartPoint } from '../../apps/desktop/src/renderer/components/messageMarks';
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

// Asking about a chart point, and charts in the chat's Files (2026-10-07).
const scatterSpec = checkChart({ ...revenue, type: 'scatter', columns: ['Spend', 'Sales'], rows: [[1, 10], [2, 12]], x: 'Spend', y: ['Sales'] });
const barSpec = checkChart({ ...revenue, type: 'bar' });
const pieSpec = checkChart({ ...revenue, type: 'pie' });

it('turns a click on a mark into the point it shows', () => {
  if (!scatterSpec.ok || !barSpec.ok || !pieSpec.ok) throw new Error('fixture charts must be valid');
  expect(chartPointOf(barSpec.spec, { seriesName: 'Revenue', name: 'Feb', value: 12 })).toEqual({ series: 'Revenue', x: 'Feb', value: '12' });
  expect(chartPointOf(scatterSpec.spec, { seriesName: 'Sales', name: '', value: [2, 12.30000001] })).toEqual({ series: 'Sales', x: '2', value: '12.3' });
  expect(chartPointOf(pieSpec.spec, { seriesName: '', name: 'Jan', value: 10 })).toEqual({ series: null, x: 'Jan', value: '10' });
  expect(chartPointOf(barSpec.spec, { name: 'Feb' })).toBeUndefined();
  expect(chartPointOf(scatterSpec.spec, { value: 5 })).toBeUndefined();
});

it('words the quote of a point with the chart, the series, the place and the value', () => {
  expect(chartPointQuote('Revenue', { series: 'Revenue', x: 'Feb', value: '12' })).toBe('About the chart “Revenue”: Revenue, Feb = 12');
  expect(chartPointQuote('Mix', { series: null, x: 'Jan', value: '10' })).toBe('About the chart “Mix”: Jan = 10');
});

it('puts the point in the composer as a reply and carries it ahead of the question', () => {
  replyToChartPoint('task-1', 'message-1', 'Researcher', 'Về biểu đồ “Revenue”: Feb = 12');
  expect(currentReplyTarget()).toMatchObject({ taskId: 'task-1', messageId: 'message-1', author: 'Researcher', point: 'Về biểu đồ “Revenue”: Feb = 12', text: 'Về biểu đồ “Revenue”: Feb = 12' });
  clearReplyTarget();
  expect(currentReplyTarget()).toBeUndefined();
});

it('lists the charts the answers of a chat carry, newest first, leaving out the ones that cannot be drawn', () => {
  const answer = (id: string, createdAt: string, summary: string) => ({ id, createdAt, report: { summary } as never });
  const charts = chartsOfChat([
    answer('a1', '2026-10-07T09:00:00Z', ['Old:', '```chart', JSON.stringify(revenue), '```'].join('\n')),
    answer('a2', '2026-10-07T10:00:00Z', ['New:', '```chart', JSON.stringify({ ...revenue, title: 'Second' }), '```', '```chart', '{broken', '```', '```chart', JSON.stringify({ ...revenue, title: 'Third' }), '```'].join('\n')),
    answer('a3', '2026-10-07T11:00:00Z', 'No chart here.'),
  ]);
  expect(charts.map(chart => [chart.id, chart.spec.title])).toEqual([['a2:0', 'Second'], ['a2:2', 'Third'], ['a1:0', 'Revenue']]);
});
