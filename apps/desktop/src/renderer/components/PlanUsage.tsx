import { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { composerUsageTone, contextPercent, usageRingFor, type ChatContext, type ComposerUsage, type ContextLine, type HarnessPlan } from '../../shared/composer-usage';
import { THREAD_VERBATIM_TURNS } from '../../shared/thread-limits';
import { SYSTEM_ACCOUNT_ID, type HarnessBankedResets, type HarnessInfo, type HarnessUsageWindow } from '../../shared/harness';
import { currentLocale, t } from '../i18n';
import { Button } from './ui';
import { AnchoredPopover } from './AnchoredPopover';
import { maskEmail } from '../../shared/pii';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The allowance's length, then the model or pool it is limited to: "Week · Opus", "Month · Auto", "Day · gemini-2.5-pro". */
export function usageWindowLabel(window: HarnessUsageWindow): string {
  if (window.kind === 'session') return t('Phiên hiện tại');
  if (window.kind === 'daily') return window.model ? t('Ngày · {0}', [window.model]) : t('Trong ngày');
  if (window.kind === 'monthly') return window.model ? t('Tháng · {0}', [window.model]) : t('Tháng');
  return window.model ? t('Tuần · {0}', [window.model]) : t('Tuần');
}

/** Within a day, how long until the reset; further off, the day and time it happens. */
export function usageResetLabel(resetsAt: string, now = new Date()): string {
  const reset = new Date(resetsAt);
  const remaining = reset.getTime() - now.getTime();
  if (remaining <= 0) return t('Đã đặt lại');
  if (remaining < HOUR_MS) return t('Đặt lại sau {0} phút', [Math.max(1, Math.round(remaining / 60_000))]);
  if (remaining < DAY_MS) {
    // Rounded as a whole first, so 1 h 59.7 min reads "2 h", not "1 h 60 min".
    const totalMinutes = Math.round(remaining / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? t('Đặt lại sau {0} giờ {1} phút', [hours, minutes]) : t('Đặt lại sau {0} giờ', [hours]);
  }
  const when = reset.toLocaleString(currentLocale(), { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  return t('Đặt lại {0}', [when]);
}

/** When an earlier reading was taken (COD-301): the clock time today, the day and time before that. */
export function usageReadingTime(asOf: string, now = new Date()): string {
  const taken = new Date(asOf);
  const sameDay = taken.toDateString() === now.toDateString();
  if (sameDay) return taken.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });
  return taken.toLocaleString(currentLocale(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Near the end of an allowance the bar takes the warning colour, then the error colour once nothing is left to spare. */
const usageTone = (usedPercent: number) => usedPercent >= 90 ? 'critical' : usedPercent >= 70 ? 'warning' : 'normal';

/**
 * How much of each allowance a subscription plan has used, one row each: what the allowance is, a bar, the
 * percentage, and when it resets. The windows come from the vendor; nothing here is estimated.
 */
export function PlanUsage({ windows, label, now }: { windows: HarnessUsageWindow[]; label: string; now?: Date }) {
  if (!windows.length) return null;
  return <div className="plan-usage" role="group" aria-label={label}>
    {windows.map(window => {
      const name = usageWindowLabel(window);
      const percent = Math.round(window.usedPercent);
      return <div key={`${window.kind}-${window.model ?? ''}`} className="plan-usage-row">
        <span className="plan-usage-label">{name}</span>
        <span className="plan-usage-bar" role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={t('Đã dùng {0}%', [percent])}>
          <span data-tone={usageTone(window.usedPercent)} style={{ width: `${percent}%` }} />
        </span>
        <span className="plan-usage-value">{percent}%</span>
        <span className="plan-usage-reset">{window.resetsAt ? usageResetLabel(window.resetsAt, now) : ''}</span>
      </div>;
    })}
  </div>;
}

/** "3 banked resets · next one ends 22/10": how many the plan holds and when the one spent next runs out (COD-328). */
export function bankedResetsLabel(resets: HarnessBankedResets): string {
  const count = resets.count === 1 ? t('Còn 1 lượt reset') : t('Còn {0} lượt reset', [resets.count]);
  if (!resets.expiresAt) return count;
  const day = new Date(resets.expiresAt).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'numeric' });
  const ends = resets.count === 1 ? t('hết hạn {0}', [day]) : t('lượt tới hết hạn {0}', [day]);
  return `${count} · ${ends}`;
}

/**
 * A Claude plan's banked resets under its usage bars: the count, when the next ends, and the action that spends one.
 * The caller leaves the action out when the reading is not fresh, and asks before spending.
 */
export function BankedResets({ resets, claiming, onClaim }: { resets: HarnessBankedResets; claiming?: boolean; onClaim?: () => void }) {
  return <div className="plan-resets">
    <span>{bankedResetsLabel(resets)}</span>
    {onClaim && <Button type="button" variant="outline" disabled={claiming} onClick={onClaim}>
      <RotateCcw size={14} aria-hidden="true" />{claiming ? t('Đang dùng lượt reset…') : t('Dùng một lượt reset')}
    </Button>}
  </div>;
}

/** How the account picker names an account: its label, or the default account's name. */
export function harnessAccountLabel(harness: Pick<HarnessInfo, 'accounts'>, accountId: string) {
  if (accountId === SYSTEM_ACCOUNT_ID) return t('Tài khoản mặc định');
  return harness.accounts.find(account => account.id === accountId)?.label ?? t('Tài khoản mặc định');
}

/** Whose plan it is, as one line: the account's name when there are several, and the address. */
function planAccountLine(plan: HarnessPlan) {
  const named = plan.harness.accounts.length > 0 ? harnessAccountLabel(plan.harness, plan.harness.accountId) : undefined;
  return [named, plan.usage.email ? maskEmail(plan.usage.email) : undefined].filter(Boolean).join(' · ');
}

const RING_RADIUS = 6;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** A ring filled as far as the closest limit is used, drawn in the button's own colour. */
function UsageRingGlyph({ percent }: { percent: number }) {
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * RING_LENGTH;
  return <svg className="usage-ring-glyph" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r={RING_RADIUS} className="usage-ring-track" />
    <circle cx="8" cy="8" r={RING_RADIUS} className="usage-ring-fill" strokeDasharray={`${filled} ${RING_LENGTH}`} transform="rotate(-90 8 8)" />
  </svg>;
}

/** Tokens the way people read them: 950, 33.4k, 1M. */
export function formatTokens(tokens: number) {
  const format = (value: number, suffix: string) => `${new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 1 }).format(value)}${suffix}`;
  if (tokens >= 1_000_000) return format(tokens / 1_000_000, 'M');
  if (tokens >= 1_000) return format(tokens / 1_000, 'k');
  return format(tokens, '');
}

/** What Orglet sends of the chat: the latest turns word for word, older ones as a summary (`core/context/thread.ts`). */
function compactionLine(context: ChatContext) {
  if (context.summarizedTurns > 0) return t('Lần gần nhất gửi nguyên văn {0} lượt; {1} lượt cũ hơn đã gộp thành tóm tắt.', [context.verbatimTurns ?? 0, context.summarizedTurns]);
  return t('Mỗi tin nhắn gửi nguyên văn tối đa {0} lượt gần nhất; lượt cũ hơn được gộp thành tóm tắt.', [THREAD_VERBATIM_TURNS]);
}

/**
 * One row of the usage popover: what it is and, beside it, the model it is about; at the right a quiet note (when an
 * allowance resets) and the figure; a thin bar under all of them when there is a share to draw. The bar follows the
 * ring's scale: muted, then the warning colour from 80%, the error colour at 100%.
 */
function UsageRow({ label, strong = false, detail, aside, value, muted = false, percent }: {
  label: string;
  strong?: boolean;
  detail?: string;
  aside?: string;
  value: string;
  /** The figure says something is not known, so it takes the quiet colour. */
  muted?: boolean;
  percent?: number;
}) {
  const shown = percent === undefined ? undefined : Math.round(percent);
  const name = detail ? `${label} · ${detail}` : label;
  return <div className="usage-row">
    <span className={strong ? 'usage-row-label strong' : 'usage-row-label'}>{label}</span>
    {detail && <span className="usage-row-detail">{detail}</span>}
    {aside && <span className="usage-row-aside">{aside}</span>}
    <span className={muted ? 'usage-row-value muted' : 'usage-row-value'}>{value}</span>
    {percent !== undefined && shown !== undefined && <span className="plan-usage-bar" role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown} aria-valuetext={t('Đã dùng {0}%', [shown])}>
      <span data-tone={composerUsageTone(percent)} style={{ width: `${Math.min(100, shown)}%` }} />
    </span>}
  </div>;
}

/** "33.4k / 1M (3%)", "0 / 200k (0%)" before the first run, or plainly that the model's size is not known. */
function contextFigure(line: ContextLine): { value: string; percent?: number; muted?: boolean } {
  if (!line.windowTokens) return { value: line.measured ? t('{0} · chưa rõ sức chứa', [formatTokens(line.usedTokens)]) : t('Chưa rõ sức chứa'), muted: true };
  const percent = contextPercent({ usedTokens: line.usedTokens, windowTokens: line.windowTokens });
  return { value: t('{0} / {1} ({2}%)', [formatTokens(line.usedTokens), formatTokens(line.windowTokens), Math.round(percent)]), percent };
}

const modelName = (line: ContextLine) => line.modelLabel ?? t('model mặc định');

/**
 * The context window of the model each orglet will use next. One orglet: the section's own row, with its model beside
 * the title. Several (a crew, a group chat): the title, then a row per orglet with its model.
 */
function ContextSection({ context }: { context: ChatContext }) {
  const title = t('Cửa sổ ngữ cảnh');
  const [first] = context.lines;
  const unknown = context.lines.some(line => !line.windowTokens);
  return <section className="usage-section" aria-label={title}>
    {context.lines.length === 1
      ? <UsageRow label={title} strong detail={modelName(first)} {...contextFigure(first)} />
      : <>
        <p className="usage-heading"><strong>{title}</strong></p>
        {context.lines.map(line => <UsageRow key={line.workerId} label={line.workerName} detail={modelName(line)} {...contextFigure(line)} />)}
      </>}
    <p className="usage-muted">{compactionLine(context)}</p>
    {unknown && <p className="usage-muted">{t('Sức chứa hiện ra khi danh sách model hoặc CLI cho biết.')}</p>}
  </section>;
}

function PlanSection({ plan, now }: { plan: HarnessPlan; now?: Date }) {
  const title = plan.usage.plan ? t('Hạn mức gói · {0}', [plan.usage.plan]) : t('Hạn mức gói');
  const account = [plan.harness.name, planAccountLine(plan)].filter(Boolean).join(' · ');
  return <section className="usage-section" aria-label={`${title} · ${plan.harness.name}`}>
    <p className="usage-heading"><strong>{title}</strong><span>{account}</span></p>
    <div role="group" aria-label={t('Hạn mức gói {0}', [plan.harness.name])} className="usage-rows">
      {plan.usage.windows.map(window => <UsageRow key={`${window.kind}-${window.model ?? ''}`} label={usageWindowLabel(window)}
        {...(window.resetsAt ? { aside: usageResetLabel(window.resetsAt, now) } : {})} value={`${Math.round(window.usedPercent)}%`} percent={window.usedPercent} />)}
    </div>
    {plan.usage.asOf && <p className="usage-muted">{t('Số liệu lúc {0}', [usageReadingTime(plan.usage.asOf, now)])}</p>}
  </section>;
}

/**
 * The ring under the message box (COD-326): how close the chat is to a limit, the tightest plan allowance or the
 * fullest context window, muted until 80%, then the warning colour, then the error colour at 100%. A click opens what
 * it is made of: first the context window of the model each orglet will use next, then each harness's plan allowances,
 * and a way to Settings → Harness.
 */
export function UsageRing({ plans, context, onOpenSettings, now }: {
  plans?: ComposerUsage;
  context?: ChatContext;
  onOpenSettings: () => void;
  now?: Date;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const ring = usageRingFor(plans, context);
  if (!ring) return null;
  const percent = Math.round(ring.percent);
  const planList = plans ? [plans.shown, ...plans.others] : [];
  const openSettings = () => {
    setOpen(false);
    onOpenSettings();
  };
  return <>
    <button ref={trigger} type="button" className="usage-ring" data-tone={ring.tone} aria-haspopup="dialog" aria-expanded={open}
      aria-label={t('Mức dùng: {0}%', [percent])} title={t('Mức dùng: {0}%', [percent])} onClick={() => setOpen(current => !current)}>
      <UsageRingGlyph percent={ring.percent} />
    </button>
    <AnchoredPopover anchor={trigger} open={open} onClose={() => setOpen(false)} label={t('Mức dùng')} className="usage-details">
      {context && <ContextSection context={context} />}
      {planList.map(plan => <PlanSection key={plan.harness.id} plan={plan} now={now} />)}
      {planList.length > 0 && <Button type="button" variant="outline" className="usage-settings" onClick={openSettings}>{t('Xem chi tiết')}</Button>}
    </AnchoredPopover>
  </>;
}

/**
 * The line under the message box from 80% on (COD-326): how much the shown account has used and when it resets, and,
 * once it is out, the account the island would offer when another one has room. Switching only selects that account;
 * nothing runs.
 */
export function PlanUsageNote({ usage, busy, onSwitch }: { usage: ComposerUsage; busy?: boolean; onSwitch: (harness: HarnessInfo, accountId: string) => void }) {
  const { shown, offer } = usage;
  if (shown.tone === 'normal') return null;
  const state = shown.tone === 'out'
    ? t('{0} hết hạn mức', [shown.harness.name])
    : t('{0} đã dùng {1}% hạn mức', [shown.harness.name, Math.round(shown.tightest.usedPercent)]);
  const sentence = shown.resetsAt ? `${state} · ${usageResetLabel(shown.resetsAt)}` : state;
  const target = shown.tone === 'out' && offer?.kind === 'switch' ? offer : undefined;
  const targetLabel = target ? harnessAccountLabel(shown.harness, target.accountId) : '';
  return <div className="usage-note" data-tone={shown.tone} role="status">
    <p>{sentence}</p>
    {target && <Button type="button" variant="outline" disabled={busy} onClick={() => onSwitch(shown.harness, target.accountId)}>
      {t('Dùng {0} · còn {1}%', [targetLabel, 100 - Math.round(target.usedPercent)])}
    </Button>}
  </div>;
}
