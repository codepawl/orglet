import type { ChartPoint } from '../shared/charts';
import { t } from './i18n';

/**
 * A value as the chart's tooltip writes it: ECharts groups the whole part of a number in threes with commas whatever
 * the language, so the quote of a point reads the same figure the person just saw ("38,200", not "38200"). A value
 * that is not a plain number (a date, a label) stays as it is.
 */
export function formatChartValue(value: string): string {
  const plainNumber = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!plainNumber) return value;
  const [, sign, whole, fraction = ''] = plainNumber;
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`;
}

/**
 * The line a click on a chart puts in the composer and ahead of the question, e.g.
 * `Về biểu đồ “Revenue”: Revenue, Feb = 12`. It names the chart, the series when there is one, where along the x
 * axis the mark sits and its value, so the orglet knows which point is meant.
 */
export function chartPointQuote(chartTitle: string, point: ChartPoint): string {
  const place = point.series ? `${point.series}, ${point.x}` : point.x;
  return t('Về biểu đồ “{0}”: {1} = {2}', [chartTitle, place, formatChartValue(point.value)]);
}
