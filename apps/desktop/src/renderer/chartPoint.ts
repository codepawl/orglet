import type { ChartPoint } from '../shared/charts';
import { t } from './i18n';

/**
 * The line a click on a chart puts in the composer and ahead of the question, e.g.
 * `Về biểu đồ “Revenue”: Revenue, Feb = 12`. It names the chart, the series when there is one, where along the x
 * axis the mark sits and its value, so the orglet knows which point is meant.
 */
export function chartPointQuote(chartTitle: string, point: ChartPoint): string {
  const place = point.series ? `${point.series}, ${point.x}` : point.x;
  return t('Về biểu đồ “{0}”: {1} = {2}', [chartTitle, place, point.value]);
}
