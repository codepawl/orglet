import { useEffect, useState } from 'react';
import type { Worker } from '../../shared/contracts';
import { CATALOG_HINT_IDS, type ModelEntry } from '../../shared/models';
import { t } from '../i18n';
import { orglet } from '../api';
import { Select } from './Select';
import { modelRunnable } from './openCodeModel';
import { isOpenCodePlan } from '../../shared/opencode';

const DEFAULT_VALUE = '';

function suggestedId(provider: Exclude<Worker['provider'], 'demo'>) {
  return Object.hasOwn(CATALOG_HINT_IDS, provider) ? CATALOG_HINT_IDS[provider as keyof typeof CATALOG_HINT_IDS] : undefined;
}

/**
 * The model this worker will answer with, on the prompt bar of a one-to-one chat. That spot used to hold a list of
 * every worker and team, which in a one-to-one chat opened on a single name the header already showed (user,
 * 2026-09-19). Choosing here saves the worker, so the Chỉnh sửa dialog shows the same model.
 */
export function ComposerModel({ worker, onChange }: {
  worker: Worker & { provider: Exclude<Worker['provider'], 'demo'> };
  onChange: (modelId: string) => void;
}) {
  const [models, setModels] = useState<ModelEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    orglet.call('modelList', { provider: worker.provider })
      .then(result => { if (!cancelled) setModels(result.models); })
      .catch(() => { if (!cancelled) setModels([]); });
    return () => { cancelled = true; };
  }, [worker.provider]);

  const suggestion = suggestedId(worker.provider);
  // A model the user typed into the worker dialog may not be in the fetched list; it still belongs in the menu.
  const listed = models.some(entry => entry.id === worker.modelId);
  // OpenCode Zen and Go have no default model, so clearing the choice is not offered there.
  const hasDefault = !isOpenCodePlan(worker.provider);
  const options = [
    ...(hasDefault ? [{ value: DEFAULT_VALUE, label: t('Mặc định'), detail: suggestion }] : []),
    ...(worker.modelId && !listed ? [{ value: worker.modelId, label: worker.modelId }] : []),
    ...models.map(entry => ({
      value: entry.id,
      label: entry.displayName ?? entry.id,
      detail: entry.displayName ? entry.id : undefined,
      ...(modelRunnable(worker.provider, entry.id) ? {} : { disabled: true, badge: t('Chưa hỗ trợ') }),
    })),
  ];

  return <Select
    className="composer-model-select"
    size="sm"
    ariaLabel={t('Model của {0}', [worker.name])}
    value={worker.modelId ?? DEFAULT_VALUE}
    onChange={onChange}
    options={options}
    showIcon={false}
    inlineDetail
    menuMinWidth={280}
  />;
}
