import type { ModelChoice } from '../../shared/modelChoices';
import { t } from '../i18n';

/** A row's name: the versioned name or ID, or "Default" for a default nobody has named. */
export function choiceLabel(choice: ModelChoice): string {
  return choice.label ?? t('Mặc định');
}

/** The one small pill a row may wear: why it cannot be picked, that it runs by default, or that it is going away. */
export function choiceBadge(choice: ModelChoice, runnable: boolean): string | undefined {
  if (!runnable) return t('Chưa hỗ trợ');
  if (choice.isDefault) return t('Mặc định');
  if (choice.entry?.deprecated) return t('Sắp ngừng');
  return undefined;
}

/**
 * Which rows a picker shows: the current models, then either a More models row or, once opened (or while the checked
 * model is one of them), the rest after a gap.
 */
export function shownChoices(choices: readonly ModelChoice[], checkedValue: string, moreOpen: boolean) {
  const main = choices.filter(choice => !choice.more);
  const more = choices.filter(choice => choice.more);
  const open = moreOpen || more.some(choice => choice.value === checkedValue);
  return { main, more: open ? more : [], moreRow: more.length > 0 && !open };
}
