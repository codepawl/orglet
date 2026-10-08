import { z } from 'zod';

/**
 * Charts in the chat (owner, 2026-10-07; .agents/plans/in-chat-visualizations.md). An orglet writes a small spec of
 * Orglet's own in a ```chart fenced block: the kind of chart, a table of data, and which columns go where. It never
 * writes HTML, JavaScript or a chart library's options; the window validates the spec here and draws it with a bundled
 * library, so a reply cannot run code. The same check backs the `check_chart` tool, so an orglet can fix a spec before
 * it sends it.
 */
export const CHART_TYPES = ['line', 'area', 'bar', 'scatter', 'pie', 'histogram'] as const;
export const ChartType = z.enum(CHART_TYPES);
export type ChartType = z.infer<typeof ChartType>;

/** The most a chart carries, so a reply stays small and the window stays quick. */
export const CHART_LIMITS = { rows: 5000, columns: 16, series: 8, pieSlices: 12, text: 300, label: 80 } as const;

const Cell = z.union([z.number().finite(), z.string().max(CHART_LIMITS.label), z.null()]);
const ColumnName = z.string().trim().min(1).max(CHART_LIMITS.label);

export const ChartSpec = z.object({
  type: ChartType,
  title: z.string().trim().min(1).max(120),
  /** One sentence saying what the chart shows, read before the chart and by screen readers. */
  takeaway: z.string().trim().min(1).max(CHART_LIMITS.text),
  columns: z.array(ColumnName).min(1).max(CHART_LIMITS.columns),
  rows: z.array(z.array(Cell)).min(1).max(CHART_LIMITS.rows),
  /** The column along the bottom: time or categories for line, area and bar; a number for scatter; the slices of a pie. */
  x: ColumnName,
  /** The columns drawn as values, one series each; a pie and a histogram take one. */
  y: z.array(ColumnName).min(1).max(CHART_LIMITS.series),
  /** Words under the axes, with the unit, e.g. "Revenue (USD)". */
  xLabel: z.string().trim().max(CHART_LIMITS.label).optional(),
  yLabel: z.string().trim().max(CHART_LIMITS.label).optional(),
  /** Bars and areas on top of each other instead of side by side. */
  stacked: z.boolean().optional(),
  /** Bars that run sideways, for long category names. */
  horizontal: z.boolean().optional(),
  /** How many bars a histogram splits its values into. */
  bins: z.number().int().min(2).max(100).optional(),
  /** Where the numbers came from, e.g. the file name, shown under the chart. */
  source: z.string().trim().max(CHART_LIMITS.label).optional(),
}).strict();
export type ChartSpec = z.infer<typeof ChartSpec>;

export type ChartCheck = { ok: true; spec: ChartSpec } | { ok: false; problems: string[] };

/**
 * Reads a chart spec from the text of a ```chart block, or from a tool call, and says exactly what is wrong in words an
 * orglet can act on. Beyond the shape, it checks what the shape cannot: that the named columns exist, that every row
 * is as wide as the header, that values are numbers where they must be, and the limits of each kind of chart.
 */
/**
 * A histogram has one column of values, and models often name it only as "x" (measured 2026-10-09: gpt-6-luna did on
 * one of twelve live requests, gpt-6.1-sol sent an empty "y" on another). That column is then the values; anything
 * else is checked as written.
 */
function withHistogramValues(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const spec = value as Record<string, unknown>;
  const noValues = spec.y === undefined || (Array.isArray(spec.y) && spec.y.length === 0);
  if (spec.type !== 'histogram' || !noValues || typeof spec.x !== 'string') return value;
  return { ...spec, y: [spec.x] };
}

export function checkChart(input: unknown): ChartCheck {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, problems: ['The chart is not valid JSON.'] };
    }
  }
  const parsed = ChartSpec.safeParse(withHistogramValues(value));
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || 'chart'}: ${issue.message}`) };
  const spec = parsed.data;
  const problems: string[] = [];
  const indexOf = (column: string) => spec.columns.indexOf(column);
  if (new Set(spec.columns).size !== spec.columns.length) problems.push('Two columns have the same name.');
  for (const column of [spec.x, ...spec.y]) if (indexOf(column) < 0) problems.push(`There is no column named "${column}".`);
  const badRow = spec.rows.findIndex(row => row.length !== spec.columns.length);
  if (badRow >= 0) problems.push(`Row ${badRow + 1} has ${spec.rows[badRow].length} cells; the header has ${spec.columns.length}.`);
  if (problems.length) return { ok: false, problems };
  const numericColumns = spec.type === 'scatter' ? [spec.x, ...spec.y] : spec.y;
  for (const column of numericColumns) {
    const index = indexOf(column);
    const wrong = spec.rows.findIndex(row => row[index] !== null && typeof row[index] !== 'number');
    if (wrong >= 0) problems.push(`Column "${column}" must hold numbers (or null); row ${wrong + 1} has ${JSON.stringify(spec.rows[wrong][index])}.`);
  }
  if ((spec.type === 'pie' || spec.type === 'histogram') && spec.y.length !== 1) problems.push(`A ${spec.type} takes exactly one value column in "y".`);
  if (spec.type === 'pie') {
    if (spec.rows.length > CHART_LIMITS.pieSlices) problems.push(`A pie has at most ${CHART_LIMITS.pieSlices} slices; use a bar chart, or fold the small ones into "Other".`);
    const index = indexOf(spec.y[0]);
    if (spec.rows.some(row => typeof row[index] === 'number' && row[index] < 0)) problems.push('A pie cannot show negative values; use a bar chart.');
  }
  if (spec.horizontal && spec.type !== 'bar') problems.push('Only a bar chart can run sideways.');
  if (spec.stacked && !['bar', 'area'].includes(spec.type)) problems.push('Only bars and areas can be stacked.');
  if (spec.bins && spec.type !== 'histogram') problems.push('Only a histogram takes bins.');
  return problems.length ? { ok: false, problems } : { ok: true, spec };
}

/** Values of one column, in row order. */
export function columnValues(spec: ChartSpec, column: string): Array<string | number | null> {
  const index = spec.columns.indexOf(column);
  return spec.rows.map(row => row[index] ?? null);
}

/** A histogram's bars: equal-width ranges over the values, each with how many values fall in it. */
export function histogramBins(values: readonly (string | number | null)[], binCount: number): { label: string; count: number }[] {
  const numbers = values.filter((value): value is number => typeof value === 'number');
  if (!numbers.length) return [];
  const least = Math.min(...numbers);
  const most = Math.max(...numbers);
  const width = most === least ? 1 : (most - least) / binCount;
  const counts = new Array(binCount).fill(0) as number[];
  for (const value of numbers) counts[Math.min(binCount - 1, Math.floor((value - least) / width))]++;
  const round = (value: number) => Number(value.toPrecision(4));
  return counts.map((count, index) => ({ label: `${round(least + index * width)}–${round(least + (index + 1) * width)}`, count }));
}

/** The colours and fonts a chart takes from the app's theme, read from its CSS tokens by the window. */
export type ChartTheme = { series: string[]; text: string; muted: string; grid: string; surface: string; font: string };

/**
 * The checked spec as ECharts options: the app's palette in a fixed order (colour follows the series, never its rank),
 * one y axis, a recessive grid, tooltips on hover (a crosshair for line and area), zoom by dragging or the wheel for
 * line, area and scatter, and a legend that hides and shows series when there are two or more.
 */
export function echartsOption(spec: ChartSpec, theme: ChartTheme): Record<string, unknown> {
  const textStyle = { color: theme.text, fontFamily: theme.font };
  const axisLine = { lineStyle: { color: theme.grid } };
  const splitLine = { lineStyle: { color: theme.grid, opacity: 0.6 } };
  const base = {
    color: theme.series,
    backgroundColor: 'transparent',
    textStyle,
    animationDuration: 250,
    aria: { enabled: true, label: { description: `${spec.title}. ${spec.takeaway}` } },
    tooltip: { trigger: spec.type === 'line' || spec.type === 'area' ? 'axis' : 'item', axisPointer: { type: spec.type === 'bar' || spec.type === 'histogram' ? 'shadow' : 'line' }, confine: true },
  };
  if (spec.type === 'pie') {
    const names = columnValues(spec, spec.x);
    const values = columnValues(spec, spec.y[0]);
    return {
      ...base,
      legend: { bottom: 0, textStyle: { color: theme.muted }, icon: 'circle' },
      series: [{ type: 'pie', radius: ['42%', '70%'], itemStyle: { borderColor: theme.surface, borderWidth: 2, borderRadius: 4 }, label: { color: theme.text },
        data: names.map((name, index) => ({ name: String(name ?? ''), value: values[index] })) }],
    };
  }
  if (spec.type === 'histogram') {
    const bins = histogramBins(columnValues(spec, spec.y[0]), spec.bins ?? 10);
    return {
      ...base,
      grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: bins.map(bin => bin.label), name: spec.xLabel ?? spec.y[0], nameLocation: 'middle', nameGap: 28, axisLine, axisLabel: { color: theme.muted } },
      yAxis: { type: 'value', name: spec.yLabel ?? 'Count', axisLine, splitLine, axisLabel: { color: theme.muted } },
      series: [{ type: 'bar', data: bins.map(bin => bin.count), barCategoryGap: '4%', itemStyle: { borderRadius: [4, 4, 0, 0] } }],
    };
  }
  const multiple = spec.y.length > 1;
  const xValues = columnValues(spec, spec.x);
  const numericX = spec.type === 'scatter';
  const zoomable = spec.type !== 'bar';
  const series = spec.y.map(column => {
    const values = columnValues(spec, column);
    const common = { name: column, emphasis: { focus: 'series' } };
    if (spec.type === 'scatter') return { ...common, type: 'scatter', symbolSize: 8, data: values.map((value, index) => [xValues[index], value]) };
    if (spec.type === 'bar') return { ...common, type: 'bar', data: values, ...(spec.stacked ? { stack: 'total' } : {}), itemStyle: { borderRadius: spec.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } };
    return { ...common, type: 'line', data: values, showSymbol: values.length <= 40, symbolSize: 6, lineStyle: { width: 2 },
      ...(spec.type === 'area' ? { areaStyle: { opacity: spec.stacked ? 0.85 : 0.18 }, ...(spec.stacked ? { stack: 'total' } : {}) } : {}) };
  });
  const categoryAxis = { type: numericX ? 'value' : 'category', data: numericX ? undefined : xValues.map(value => String(value ?? '')), name: spec.xLabel, nameLocation: 'middle', nameGap: 28, axisLine, axisLabel: { color: theme.muted, hideOverlap: true }, boundaryGap: spec.type === 'bar' };
  const valueAxis = { type: 'value', name: spec.yLabel, axisLine, splitLine, axisLabel: { color: theme.muted } };
  return {
    ...base,
    // Room above the plot for the legend and for the value axis's name, which ECharts draws over the top line.
    grid: { left: 8, right: 16, top: (multiple ? 36 : 12) + (spec.yLabel && !spec.horizontal ? 18 : 0), bottom: 8, containLabel: true },
    ...(multiple ? { legend: { top: 0, textStyle: { color: theme.muted }, icon: 'roundRect' } } : {}),
    xAxis: spec.horizontal ? valueAxis : categoryAxis,
    yAxis: spec.horizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    ...(zoomable ? { dataZoom: [{ type: 'inside', xAxisIndex: 0 }] } : {}),
    series,
  };
}

/** The spec's table as CSV, for Download data and the table view. */
export function chartCsv(spec: ChartSpec): string {
  const cell = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [spec.columns, ...spec.rows].map(row => row.map(cell).join(',')).join('\n');
}

/**
 * What is wrong with each ```chart block of a reply, numbered in reply order; empty when every chart can be drawn.
 * The reply tool sends these back once, so the orglet fixes its chart instead of the person seeing a broken one.
 */
export function chartProblemsIn(reply: string): string[] {
  const problems: string[] = [];
  chartFencesIn(reply).forEach((source, index) => {
    const checked = checkChart(source);
    if (!checked.ok) problems.push(...checked.problems.map(problem => `Chart ${index + 1}: ${problem}`));
  });
  return problems;
}

/** The text of each ```chart block of a reply, in reply order. */
export function chartFencesIn(reply: string): string[] {
  return Array.from(reply.matchAll(/^\s*```\s*chart\s*\n([\s\S]*?)^\s*```/gim), fence => fence[1]);
}

/** A mark someone clicked on a chart, as ECharts reports it. Only these fields are read. */
export type ChartClick = { seriesName?: string; name?: string; value?: unknown };

/** What a click on a chart points at: which series, where along the x axis and the value there. */
export type ChartPoint = { series: string | null; x: string; value: string };

function plainValue(value: unknown): string {
  return typeof value === 'number' ? String(Number(value.toPrecision(6))) : String(value);
}

/**
 * The point a click landed on, from the spec and the click ECharts reports: a bar or a line mark has its category in
 * `name` and its value alone, a scatter mark carries [x, y], a pie slice its name and value, a histogram bar its range.
 * Nothing when the click carries no value, such as one on the empty plot.
 */
export function chartPointOf(spec: ChartSpec, click: ChartClick): ChartPoint | undefined {
  const { value } = click;
  if (value === undefined || value === null) return undefined;
  const series = click.seriesName && click.seriesName.length > 0 ? click.seriesName : null;
  if (spec.type === 'scatter') {
    if (!Array.isArray(value) || value.length < 2) return undefined;
    return { series, x: plainValue(value[0]), value: plainValue(value[1]) };
  }
  if (Array.isArray(value)) return undefined;
  if (spec.type === 'pie' || spec.type === 'histogram') return { series: null, x: click.name ?? '', value: plainValue(value) };
  return { series, x: click.name ?? '', value: plainValue(value) };
}
