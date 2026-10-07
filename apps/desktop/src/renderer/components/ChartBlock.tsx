import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { AriaComponent, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { init, use, type EChartsType } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { ChartNoAxesColumn, Download, ImageDown, Maximize2, MousePointerClick, Table2, TriangleAlert } from 'lucide-react';
import { Button } from './ui';
import { Tooltip } from '@codepawlhq/orglet-ui';
import { SourceViewer } from './SourceViewer';
import { TablePreview } from './TablePreview';
import { chartCsv, chartPointOf, checkChart, columnValues, echartsOption, type ChartClick, type ChartPoint, type ChartSpec, type ChartTheme } from '../../shared/charts';
import { chartPointQuote } from '../chartPoint';
import { t, translated } from '../i18n';
import { orglet } from '../api';

// Only the parts a chat chart uses, so the bundle carries six chart kinds and not the whole library.
use([LineChart, BarChart, ScatterChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, AriaComponent, SVGRenderer]);

const PLOT_HEIGHT = 280;
/** The large view takes most of the window's height, never less than this. */
const LARGE_PLOT_MINIMUM = 360;

const chartTypeNames: Record<ChartSpec['type'], string> = translated({
  line: 'Biểu đồ đường',
  area: 'Biểu đồ vùng',
  bar: 'Biểu đồ cột',
  scatter: 'Biểu đồ phân tán',
  pie: 'Biểu đồ tròn',
  histogram: 'Biểu đồ phân bố',
});

/** The chart colours and type from the app's tokens, read again when the theme changes. */
function themeFrom(element: HTMLElement): ChartTheme {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    series: Array.from({ length: 8 }, (_, index) => token(`--chart-${index + 1}`)),
    text: token('--text'),
    muted: token('--muted'),
    grid: token('--border'),
    surface: token('--bg'),
    font: style.fontFamily,
  };
}

/** Whether the app is drawn dark right now, so the chart redraws when the person switches theme. */
function useThemeKey(): string {
  const [key, setKey] = useState(() => document.documentElement.dataset.theme ?? 'system');
  useEffect(() => {
    const observer = new MutationObserver(() => setKey(document.documentElement.dataset.theme ?? 'system'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const media = matchMedia('(prefers-color-scheme: dark)');
    const followSystem = () => setKey(current => `${current.split(':')[0]}:${media.matches}`);
    media.addEventListener('change', followSystem);
    return () => { observer.disconnect(); media.removeEventListener('change', followSystem); };
  }, []);
  return key;
}

/**
 * The point of a line or an area under a click on the plot. A line has no mark to hit between its symbols, so the click
 * is turned into the nearest category along the x axis and, with several series, the series whose value is closest to
 * the pointer.
 */
function linePointAt(spec: ChartSpec, chart: EChartsType, pixel: [number, number]): ChartPoint | undefined {
  if (!chart.containPixel('grid', pixel)) return undefined;
  const categoryIndex = Math.round(Number(chart.convertFromPixel({ xAxisIndex: 0 }, pixel[0])));
  const categories = columnValues(spec, spec.x);
  if (!Number.isInteger(categoryIndex) || categoryIndex < 0 || categoryIndex >= categories.length) return undefined;
  let nearest: { series: string; value: number; distance: number } | undefined;
  for (const column of spec.y) {
    const value = columnValues(spec, column)[categoryIndex];
    if (typeof value !== 'number') continue;
    const distance = Math.abs(Number(chart.convertToPixel({ yAxisIndex: 0 }, value)) - pixel[1]);
    if (!nearest || distance < nearest.distance) nearest = { series: column, value, distance };
  }
  if (!nearest) return undefined;
  return { series: nearest.series, x: String(categories[categoryIndex] ?? ''), value: String(Number(nearest.value.toPrecision(6))) };
}

/** The drawn chart: hover for values, drag or scroll to zoom where it helps, the legend to hide and show series. */
function Plot({ spec, height, onChart, onPoint }: { spec: ChartSpec; height: number; onChart: (chart: EChartsType | undefined) => void; onPoint?: (point: ChartPoint) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const themeKey = useThemeKey();
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const chart = init(element, undefined, { renderer: 'svg', height });
    chart.setOption(echartsOption(spec, themeFrom(element)));
    onChart(chart);
    if (onPoint) {
      if (spec.type === 'line' || spec.type === 'area') {
        chart.getZr().on('click', event => {
          const point = linePointAt(spec, chart, [event.offsetX, event.offsetY]);
          if (point) onPoint(point);
        });
      } else {
        chart.on('click', (click: ChartClick) => {
          const point = chartPointOf(spec, click);
          if (point) onPoint(point);
        });
      }
    }
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(element);
    return () => { resize.disconnect(); onChart(undefined); chart.dispose(); };
  }, [spec, themeKey, height, onChart, onPoint]);
  return <div ref={host} className={onPoint ? 'chart-plot chart-askable' : 'chart-plot'} style={{ height }} role="img" aria-label={`${spec.title}. ${spec.takeaway}`} />;
}

type ChartButtonsProps = { spec: ChartSpec; chart: RefObject<EChartsType | undefined>; showTable: boolean; onToggleTable: () => void; onOpenLarge?: () => void };

/** The chart's own buttons: the data as a table, the picture as PNG, the data as CSV, and the large view. */
function ChartButtons({ spec, chart, showTable, onToggleTable, onOpenLarge }: ChartButtonsProps) {
  const savePicture = () => {
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const picture = chart.current?.getDataURL({ type: 'png', pixelRatio: 2, ...(background ? { backgroundColor: background } : {}) });
    if (picture) void orglet.saveChart(spec.title, 'png', picture);
  };
  const tableLabel = showTable ? t('Xem biểu đồ') : t('Xem bảng số liệu');
  return <>
    <Tooltip label={tableLabel}>
      <Button variant="ghost" size="icon" aria-pressed={showTable} aria-label={tableLabel} onClick={onToggleTable}>
        {showTable ? <ChartNoAxesColumn size={15} /> : <Table2 size={15} />}
      </Button>
    </Tooltip>
    {!showTable && <Tooltip label={t('Lưu ảnh PNG')}>
      <Button variant="ghost" size="icon" aria-label={t('Lưu ảnh PNG')} onClick={savePicture}><ImageDown size={15} /></Button>
    </Tooltip>}
    <Tooltip label={t('Lưu số liệu CSV')}>
      <Button variant="ghost" size="icon" aria-label={t('Lưu số liệu CSV')} onClick={() => void orglet.saveChart(spec.title, 'csv', chartCsv(spec))}><Download size={15} /></Button>
    </Tooltip>
    {onOpenLarge && <Tooltip label={t('Mở lớn')}>
      <Button variant="ghost" size="icon" aria-label={t('Mở lớn')} onClick={onOpenLarge}><Maximize2 size={15} /></Button>
    </Tooltip>}
  </>;
}

/**
 * A chart's frame: the title and the one-line takeaway first, the plot after, and under it the hint to click a point
 * (when a click can ask about it) and where the numbers came from. In the large view the viewer's own bar already
 * carries the title, so the frame keeps only the takeaway.
 */
function ChartFigure({ spec, large, onAskPoint, onOpenLarge }: { spec: ChartSpec; large?: boolean; onAskPoint?: (quote: string) => void; onOpenLarge?: () => void }) {
  const [showTable, setShowTable] = useState(false);
  const chart = useRef<EChartsType | undefined>(undefined);
  const setChart = useMemo(() => (instance: EChartsType | undefined) => { chart.current = instance; }, []);
  const height = large ? Math.max(LARGE_PLOT_MINIMUM, Math.round(window.innerHeight * 0.6)) : PLOT_HEIGHT;
  const askAbout = useMemo(() => (onAskPoint ? (point: ChartPoint) => onAskPoint(chartPointQuote(spec.title, point)) : undefined), [onAskPoint, spec.title]);
  return <figure className={large ? 'chart-block chart-large' : 'chart-block'} aria-label={spec.title}>
    <div className="chart-top">
      <figcaption className="chart-head">
        {!large && <strong className="chart-title"><ChartNoAxesColumn size={15} aria-hidden="true" />{spec.title}</strong>}
        <span className="chart-takeaway">{spec.takeaway}</span>
      </figcaption>
      {/* The chart's own toolbar, set against the right edge of its frame on purpose, not icons floating past the text. */}
      <span className="chart-actions" data-align-ignore="stranded">
        <ChartButtons spec={spec} chart={chart} showTable={showTable} onToggleTable={() => setShowTable(current => !current)} onOpenLarge={onOpenLarge} />
      </span>
    </div>
    {showTable ? <TablePreview text={chartCsv(spec)} delimiter="," /> : <Plot spec={spec} height={height} onChart={setChart} onPoint={askAbout} />}
    {(spec.source || (askAbout && !showTable)) && <div className="chart-foot">
      {askAbout && !showTable && <span className="chart-hint"><MousePointerClick size={13} aria-hidden="true" />{t('Bấm vào một điểm để hỏi về nó')}</span>}
      {spec.source && <span className="chart-source">{t('Nguồn: {0}', [spec.source])}</span>}
    </div>}
  </figure>;
}

/**
 * A chart in the large view, opened from the chat or from the chat's Files: the same viewer a file opens in, with the
 * chart at the size of the window. Asking about a point closes it, so the composer behind it is in reach.
 */
export function ChartViewer({ spec, onClose, onAskPoint }: { spec: ChartSpec; onClose: () => void; onAskPoint?: (quote: string) => void }) {
  const askThenClose = useMemo(() => (onAskPoint ? (quote: string) => { onAskPoint(quote); onClose(); } : undefined), [onAskPoint, onClose]);
  const info = [
    { label: t('Loại'), value: chartTypeNames[spec.type] },
    { label: t('Số dòng'), value: String(spec.rows.length) },
    ...(spec.source ? [{ label: t('Nguồn'), value: spec.source }] : []),
  ];
  return <SourceViewer open onClose={onClose} name={spec.title} meta={chartTypeNames[spec.type]} icon={ChartNoAxesColumn}
    info={info} infoLabel={t('Thông tin về biểu đồ này')} menuLabel={t('Tùy chọn')}>
    <ChartFigure spec={spec} large onAskPoint={askThenClose} />
  </SourceViewer>;
}

/**
 * A chart an orglet sent in a ```chart block (shared/charts.ts). The title and the one-line takeaway come first, the
 * plot after, and under it where the numbers came from and the actions: the data as a table, the picture as PNG, the
 * data as CSV and the large view. A spec that does not pass the check shows why, with the raw block, and never an
 * empty frame. `onAskPoint` is given the quoted line when someone clicks a point to ask about it.
 */
export default function ChartBlock({ source, onAskPoint }: { source: string; onAskPoint?: (quote: string) => void }) {
  const checked = useMemo(() => checkChart(source), [source]);
  const [large, setLarge] = useState(false);
  if (!checked.ok) {
    return <div className="chart-block chart-invalid" role="group" aria-label={t('Biểu đồ không vẽ được')}>
      <p className="chart-problem"><TriangleAlert size={15} aria-hidden="true" />{t('Biểu đồ này không vẽ được: {0}', [checked.problems[0]])}</p>
      <pre><code>{source}</code></pre>
    </div>;
  }
  return <>
    <ChartFigure spec={checked.spec} onAskPoint={onAskPoint} onOpenLarge={() => setLarge(true)} />
    {large && <ChartViewer spec={checked.spec} onClose={() => setLarge(false)} onAskPoint={onAskPoint} />}
  </>;
}
