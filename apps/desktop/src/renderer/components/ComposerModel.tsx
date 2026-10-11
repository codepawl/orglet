import { useEffect } from 'react';
import type { Worker } from '../../shared/contracts';
import type { HarnessPlan } from '../../shared/composer-usage';
import { checkedChoiceValue, modelChoices, type ModelChoice } from '../../shared/modelChoices';
import { modelMenuRows } from '../../shared/model-menu';
import type { ModelEntry } from '../../shared/models';
import { t } from '../i18n';
import { modelLists } from '../caches';
import { useCached } from '../prefetch';
import { ModelMenu, type ModelMenuRow } from './ModelMenu';
import { modelRunnable } from './openCodeModel';
import { modelIdRequired } from './workerModel';
import { choiceBadge, choiceLabel } from './modelRows';

/** How long after a stale list the window asks the core again. */
const STALE_LIST_REREAD_MS = 15_000;

type ConnectedWorker = Worker & { provider: Exclude<Worker['provider'], 'demo'> };

function menuRow(worker: ConnectedWorker, choice: ModelChoice): ModelMenuRow {
  const runnable = !choice.entry || modelRunnable(worker.provider, choice.entry.id);
  const badge = choiceBadge(choice, runnable);
  return {
    value: choice.value,
    label: choiceLabel(choice),
    vendor: choice.vendor,
    ...(badge ? { badge } : {}),
    ...(runnable ? {} : { disabled: true }),
  };
}

/**
 * The model this worker will answer with, on the prompt bar of a one-to-one chat. That spot used to hold a list of
 * every worker and team, which in a one-to-one chat opened on a single name the header already showed (user,
 * 2026-09-19). Choosing here saves the worker, so the Chỉnh sửa dialog shows the same model.
 *
 * Each row is the model's maker's mark and its versioned name; the one that runs when nothing is set wears Default and
 * saves nothing, so the orglet keeps following the CLI's default. Older models sit in a panel beside the menu under
 * More models (COD-332), and the plan allowance of the harness behind the chat sits at the top (`plan`).
 */
export function ComposerModel({ worker, plan, onChange, onOpenSettings }: {
  worker: ConnectedWorker;
  plan?: HarnessPlan | undefined;
  onChange: (modelId: string) => void;
  onOpenSettings: () => void;
}) {
  // The session's copy of the list (COD-218): fetched while the worker's row rested under the pointer, or by the
  // dialog, so the menu is full the first time it opens. Until it lands the menu offers the default and the saved id.
  const list = useCached(modelLists, worker.provider);
  const models: ModelEntry[] = list?.models ?? [];
  // A stale list means the core is fetching a newer one (Claude Code names its aliases by starting the CLI, which
  // takes half a minute). The session's copy would otherwise stay the old one until the app restarts, and showed
  // "Opus" above "Opus 5.5" all day (owner, 2026-10-11). It is read again until it comes back current.
  const stale = list?.stale === true;
  const fetchedAt = list?.fetchedAt;
  useEffect(() => {
    if (!stale) return undefined;
    const timer = setTimeout(() => {
      modelLists.refresh(worker.provider).catch(() => { /* the kept list stays; the next reading tries again */ });
    }, STALE_LIST_REREAD_MS);
    return () => clearTimeout(timer);
  }, [stale, fetchedAt, worker.provider]);
  // OpenCode plans and custom connections have no default model, so clearing the choice is not offered there.
  const choices = modelChoices(worker.provider, models, !modelIdRequired(worker.provider));
  const checked = checkedChoiceValue(choices, worker.modelId);
  const { main, sidePanel, checkedInSidePanel } = modelMenuRows(choices, checked);
  // A model the user typed into the worker dialog may not be in the fetched list; it still belongs in the menu.
  const listed = choices.some(choice => choice.value === checked);
  const typedRow: ModelMenuRow | undefined = listed || !checked ? undefined : { value: checked, label: checked, vendor: undefined };
  const checkedSideChoice = checkedInSidePanel ? choices.find(choice => choice.value === checked) : undefined;
  const currentOutsideMain = checkedSideChoice ? menuRow(worker, checkedSideChoice) : typedRow;
  const currentChoice = choices.find(choice => choice.value === checked);
  const currentLabel = currentChoice ? choiceLabel(currentChoice) : checked;

  return <ModelMenu
    ariaLabel={t('Model của {0}', [worker.name])}
    currentLabel={currentLabel}
    provider={worker.provider}
    checked={checked}
    mainRows={main.map(choice => menuRow(worker, choice))}
    {...(currentOutsideMain ? { currentOutsideMain } : {})}
    sideRows={sidePanel.map(choice => menuRow(worker, choice))}
    {...(plan ? { plan } : {})}
    onSelect={onChange}
    onOpenSettings={onOpenSettings}
  />;
}
