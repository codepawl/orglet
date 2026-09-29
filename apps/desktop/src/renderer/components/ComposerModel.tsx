import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Worker } from '../../shared/contracts';
import { checkedChoiceValue, modelChoices, type ModelChoice } from '../../shared/modelChoices';
import type { ModelEntry } from '../../shared/models';
import { t } from '../i18n';
import { modelLists } from '../caches';
import { useCached } from '../prefetch';
import { Select, type SelectOption } from './Select';
import { ModelMark } from './ProviderMark';
import { modelRunnable } from './openCodeModel';
import { modelIdRequired } from './workerModel';
import { choiceBadge, choiceLabel, shownChoices } from './modelRows';

/** The value of the More models row; never saved, since that row is an action. */
const MORE_ROW = '\u0000more';

type ConnectedWorker = Worker & { provider: Exclude<Worker['provider'], 'demo'> };

function choiceOption(worker: ConnectedWorker, choice: ModelChoice): SelectOption {
  const runnable = !choice.entry || modelRunnable(worker.provider, choice.entry.id);
  const badge = choiceBadge(choice, runnable);
  return {
    value: choice.value,
    label: choiceLabel(choice),
    icon: <ModelMark vendor={choice.vendor} provider={worker.provider} />,
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
 * saves nothing, so the orglet keeps following the CLI's default. Older models sit under More models (COD-332).
 */
export function ComposerModel({ worker, onChange }: {
  worker: ConnectedWorker;
  onChange: (modelId: string) => void;
}) {
  // The session's copy of the list (COD-218): fetched while the worker's row rested under the pointer, or by the
  // dialog, so the menu is full the first time it opens. Until it lands the menu offers the default and the saved id.
  const models: ModelEntry[] = useCached(modelLists, worker.provider)?.models ?? [];
  const [moreOpen, setMoreOpen] = useState(false);
  // OpenCode plans and custom connections have no default model, so clearing the choice is not offered there.
  const choices = modelChoices(worker.provider, models, !modelIdRequired(worker.provider));
  const checked = checkedChoiceValue(choices, worker.modelId);
  const shown = shownChoices(choices, checked, moreOpen);
  // A model the user typed into the worker dialog may not be in the fetched list; it still belongs in the menu.
  const listed = choices.some(choice => choice.value === checked);
  const options: SelectOption[] = [
    ...shown.main.map(choice => choiceOption(worker, choice)),
    ...(listed || !checked ? [] : [{ value: checked, label: checked, icon: <ModelMark vendor={undefined} provider={worker.provider} /> }]),
    ...(shown.moreRow ? [{ value: MORE_ROW, label: t('Thêm model'), icon: <ChevronDown size={16} />, spaced: true, onSelect: () => setMoreOpen(true) }] : []),
    ...shown.more.map((choice, index) => ({ ...choiceOption(worker, choice), spaced: index === 0 })),
  ];

  return <Select
    className="composer-model-select"
    size="sm"
    ariaLabel={t('Model của {0}', [worker.name])}
    value={checked}
    onChange={modelId => { setMoreOpen(false); onChange(modelId); }}
    options={options}
    showIcon={false}
    showDetail={false}
    menuMinWidth={260}
  />;
}
