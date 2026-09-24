import type { HarnessUsageWindow } from '../../shared/harness';
import { currentLocale, t } from '../i18n';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function usageWindowLabel(window: HarnessUsageWindow): string {
  if (window.kind === 'session') return t('Phiên hiện tại');
  if (window.kind === 'monthly') return t('Tháng');
  return window.model ? t('Tuần · {0}', [window.model]) : t('Tuần');
}

/** Within a day, how long until the reset; further off, the day and time it happens. */
export function usageResetLabel(resetsAt: string, now = new Date()): string {
  const reset = new Date(resetsAt);
  const remaining = reset.getTime() - now.getTime();
  if (remaining <= 0) return t('Đã đặt lại');
  if (remaining < HOUR_MS) return t('Đặt lại sau {0} phút', [Math.max(1, Math.round(remaining / 60_000))]);
  if (remaining < DAY_MS) {
    const hours = Math.floor(remaining / HOUR_MS);
    const minutes = Math.round((remaining % HOUR_MS) / 60_000);
    return minutes ? t('Đặt lại sau {0} giờ {1} phút', [hours, minutes]) : t('Đặt lại sau {0} giờ', [hours]);
  }
  const when = reset.toLocaleString(currentLocale(), { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  return t('Đặt lại {0}', [when]);
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
