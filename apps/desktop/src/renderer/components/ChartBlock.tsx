import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { AriaComponent, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { init, use, type EChartsType } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { ChartNoAxesColumn, Download, ImageDown, Table2, TriangleAlert } from 'lucide-react';
import { Button } from './ui';
import { Tooltip } from '@codepawlhq/orglet-ui';
import { TablePreview } from './TablePreview';
import { chartCsv, checkChart, echartsOption, type ChartSpec, type ChartTheme } from '../../shared/charts';
import { t } from '../i18n';
import { orglet } from '../api';

// Only the parts a chat chart uses, so the bundle carries six chart kinds and not the whole library.
use([LineChart, BarChart, ScatterChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, AriaComponent, SVGRenderer]);

const PLOT_HEIGHT = 280;

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

/** The drawn chart: hover for values, drag or scroll to zoom where it helps, the legend to hide and show series. */
function Plot({ spec, onChart }: { spec: ChartSpec; onChart: (chart: EChartsType | undefined) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const themeKey = useThemeKey();
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const chart = init(element, undefined, { renderer: 'svg', height: PLOT_HEIGHT });
    chart.setOption(echartsOption(spec, themeFrom(element)));
    onChart(chart);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(element);
    return () => { resize.disconnect(); onChart(undefined); chart.dispose(); };
  }, [spec, themeKey, onChart]);
  return <div ref={host} className="chart-plot" style={{ height: PLOT_HEIGHT }} role="img" aria-label={`${spec.title}. ${spec.takeaway}`} />;
}

/**
 * A chart an orglet sent in a ```chart block (shared/charts.ts). The title and the one-line takeaway come first, the
 * plot after, and under it where the numbers came from and the actions: the data as a table, the picture as PNG and
 * the data as CSV. A spec that does not pass the check shows why, with the raw block, and never an empty frame.
 */
export default function ChartBlock({ source }: { source: string }) {
  const checked = useMemo(() => checkChart(source), [source]);
  const [showTable, setShowTable] = useState(false);
  const chart = useRef<EChartsType | undefined>(undefined);
  const setChart = useMemo(() => (instance: EChartsType | undefined) => { chart.current = instance; }, []);
  if (!checked.ok) {
    return <div className="chart-block chart-invalid" role="group" aria-label={t('Biểu đồ không vẽ được')}>
      <p className="chart-problem"><TriangleAlert size={15} aria-hidden="true" />{t('Biểu đồ này không vẽ được: {0}', [checked.problems[0]])}</p>
      <pre><code>{source}</code></pre>
    </div>;
  }
  const spec = checked.spec;
  const savePicture = () => {
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const picture = chart.current?.getDataURL({ type: 'png', pixelRatio: 2, ...(background ? { backgroundColor: background } : {}) });
    if (picture) void orglet.saveChart(spec.title, 'png', picture);
  };
  return <figure className="chart-block" aria-label={spec.title}>
    <div className="chart-top">
      <figcaption className="chart-head">
        <strong className="chart-title"><ChartNoAxesColumn size={15} aria-hidden="true" />{spec.title}</strong>
        <span className="chart-takeaway">{spec.takeaway}</span>
      </figcaption>
      {/* The chart's own toolbar, set against the right edge of its frame on purpose, not icons floating past the text. */}
      <span className="chart-actions" data-align-ignore="stranded">
        <Tooltip label={showTable ? t('Xem biểu đồ') : t('Xem bảng số liệu')}>
          <Button variant="ghost" size="icon" aria-pressed={showTable} aria-label={showTable ? t('Xem biểu đồ') : t('Xem bảng số liệu')} onClick={() => setShowTable(current => !current)}>
            {showTable ? <ChartNoAxesColumn size={15} /> : <Table2 size={15} />}
          </Button>
        </Tooltip>
        {!showTable && <Tooltip label={t('Lưu ảnh PNG')}>
          <Button variant="ghost" size="icon" aria-label={t('Lưu ảnh PNG')} onClick={savePicture}><ImageDown size={15} /></Button>
        </Tooltip>}
        <Tooltip label={t('Lưu số liệu CSV')}>
          <Button variant="ghost" size="icon" aria-label={t('Lưu số liệu CSV')} onClick={() => void orglet.saveChart(spec.title, 'csv', chartCsv(spec))}><Download size={15} /></Button>
        </Tooltip>
      </span>
    </div>
    {showTable ? <TablePreview text={chartCsv(spec)} delimiter="," /> : <Plot spec={spec} onChart={setChart} />}
    {spec.source && <span className="chart-source">{t('Nguồn: {0}', [spec.source])}</span>}
  </figure>;
}
