import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { ChevronRight } from 'lucide-react';
import type { TaskStatus } from '../../shared/contracts';
import type { CrewPlanDiagram, CrewStep, CrewStepState } from '../../shared/crew-plan';
import { Avatar } from './Avatar';
import { StatusMark, type StatusMarkState } from './StatusMark';
import { overflowAttributes, useStripOverflow } from '../stripOverflow';
import { t } from '../i18n';

const stepMarks: Record<CrewStepState, StatusMarkState> = {
  waiting: { variant: 'dashed', tone: 'muted' },
  working: { variant: 'busy', tone: 'working' },
  done: { variant: 'filled', tone: 'success' },
  failed: { variant: 'filled', tone: 'error' },
  stopped: { variant: 'empty', tone: 'muted' },
  paused: { variant: 'paused', tone: 'muted' },
  needs_you: { variant: 'dashed', tone: 'error' },
};

/**
 * A crew turn as a flow diagram (COD-331): the lead's box, an arrow down, the members' rows (side by side when they
 * work at the same time, one under another when each waits for the one before), then the lead combining the results.
 * Every box is a run the core saved, with its live status; `crewPlanDiagram` builds it and returns nothing without a
 * saved plan. It folds like the trace: open while the turn is live when it first appears, folded on an older turn.
 */
export function CrewPlanFlow({ diagram, live, statusLabel }: { diagram: CrewPlanDiagram; live: boolean; statusLabel: Record<TaskStatus, string> }) {
  const [open, setOpen] = useState(live);
  const stepLabel = (step: CrewStep) => step.waitingFor.length > 0
    ? `${statusLabel[step.status]} · ${t('Chờ {0}', [step.waitingFor.join(', ')])}`
    : statusLabel[step.status];
  const leadSummary = diagram.lead.summary || t('Chia việc cho {0} Tí', [diagram.memberCount]);
  const combineSummary = diagram.combine.summary || t('Gộp kết quả thành câu trả lời');
  const items: ReactNode[] = [<FlowStep key="lead" step={diagram.lead} summary={leadSummary} label={stepLabel(diagram.lead)} />];
  const rows = [...diagram.rows.map(row => ({ key: row[0].id, steps: row })), { key: 'combine', steps: [diagram.combine] }];
  for (const [index, row] of rows.entries()) {
    const single = row.steps.length === 1;
    items.push(<li key={`link-${row.key}`} className={single ? 'crew-link crew-link-arrow' : 'crew-link'} aria-hidden="true" />);
    const last = index === rows.length - 1;
    if (single) items.push(<FlowStep key={row.key} step={row.steps[0]} summary={last ? combineSummary : row.steps[0].summary} label={stepLabel(row.steps[0])} />);
    else items.push(<FlowFan key={row.key} steps={row.steps} labelOf={stepLabel} />);
  }
  const doneCount = diagram.rows.flat().filter(step => step.state === 'done').length;
  return <>
    <details className="crew-plan" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="activity-summary">
        <ChevronRight size={14} aria-hidden="true" className="activity-chevron" />
        <span>{planSummary(diagram)}</span>
      </summary>
      <ol className="crew-flow" aria-label={t('Các bước của kênh')}>{items}</ol>
    </details>
    {/* The plain progress lines this replaces were a status region; the count keeps a screen reader told, folded or not. */}
    {live && <span className="visually-hidden" role="status">{t('{0}/{1} phần việc đã xong', [doneCount, diagram.memberCount])}</span>}
  </>;
}

function planSummary(diagram: CrewPlanDiagram): string {
  if (diagram.shape === 'side_by_side') return t('Kế hoạch của Tí trưởng: {0} Tí làm cùng lúc', [diagram.memberCount]);
  if (diagram.shape === 'one_after_another') return t('Kế hoạch của Tí trưởng: {0} Tí làm lần lượt', [diagram.memberCount]);
  return t('Kế hoạch của Tí trưởng: {0} Tí qua {1} bước', [diagram.memberCount, diagram.rows.length]);
}

/**
 * Members working at the same time, side by side. The lines that fan out to them and join again below are drawn by
 * each cell, so they stay attached when more members than fit scroll sideways inside the row.
 */
function FlowFan({ steps, labelOf }: { steps: CrewStep[]; labelOf: (step: CrewStep) => string }) {
  const strip = useRef<HTMLOListElement>(null);
  const overflow = useStripOverflow(strip, steps.length);
  const scrolls = overflow.start || overflow.end;
  // The scrollbar's lane sits under the cells, between the joining line and the arrow below; the fan bridges it. It
  // is read after every render, which the overflow above repeats whenever the row scrolls or resizes.
  const [lane, setLane] = useState(0);
  useLayoutEffect(() => {
    const row = strip.current;
    const measured = row ? row.offsetHeight - row.clientHeight : 0;
    if (measured !== lane) setLane(measured);
  });
  return <li className="crew-fan" style={{ '--fan-lane': `${lane}px` } as CSSProperties}>
    <ol className="crew-fan-row" ref={strip} aria-label={t('Làm cùng lúc')} tabIndex={scrolls ? 0 : undefined} {...overflowAttributes(overflow)}>
      {steps.map(step => <FlowStep key={step.id} step={step} summary={step.summary} label={labelOf(step)} cell />)}
    </ol>
  </li>;
}

/**
 * One box: the orglet's face and name with its status mark on the name's line, and under them its part in at most two
 * lines. When the part is longer than that, the box is a button that shows it whole.
 */
function FlowStep({ step, summary, label, cell = false }: { step: CrewStep; summary: string; label: string; cell?: boolean }) {
  const summaryRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const clipped = useClipped(summaryRef, expanded);
  const worker = step.worker;
  const content = <>
    <span className="crew-node-head">
      <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs" />
      <span className="crew-node-name" title={worker.name}>{worker.name}</span>
      <StatusMark variant={stepMarks[step.state].variant} tone={stepMarks[step.state].tone} label={label} decorative />
      <span className="visually-hidden">{label}</span>
    </span>
    <span ref={summaryRef} className={expanded ? 'crew-node-summary expanded' : 'crew-node-summary'}>{summary}</span>
  </>;
  const className = `crew-node crew-node-${step.state}`;
  const node = clipped || expanded
    ? <button type="button" className={className} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{content}</button>
    : <div className={className}>{content}</div>;
  return <li className={cell ? 'crew-cell' : 'crew-step'}>{node}</li>;
}

/** Whether a line-clamped text is cut, measured again when its box resizes. Kept while the text is shown whole. */
function useClipped(text: RefObject<HTMLElement | null>, expanded: boolean): boolean {
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = text.current;
    if (!element || expanded) return;
    const measure = () => setClipped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);
  return clipped;
}
