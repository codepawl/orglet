import type { Worker } from '../../shared/contracts';
import { modelEffort, resolveEffort, type Effort } from '../../shared/effort';
import { t } from '../i18n';
import { modelLists } from '../caches';
import { useCached } from '../prefetch';
import { Select, type SelectOption } from './Select';

type ConnectedWorker = Worker & { provider: Exclude<Worker['provider'], 'demo'> };

/** The value of the row that saves no effort, so the app picks one for each kind of turn. */
const AUTOMATIC = '';

/**
 * How hard this orglet thinks, on the prompt bar beside its model (owner, 2026-10-12). The orglet's dialog holds the
 * same choice; a person who changes the model for one question often wants to change this with it. Choosing here
 * saves the orglet. It is not shown for a model and connection that take no effort setting, where it would do nothing.
 */
export function ComposerEffort({ worker, onChange }: {
  worker: ConnectedWorker;
  onChange: (effort: Effort | undefined) => void;
}) {
  const models = useCached(modelLists, worker.provider)?.models ?? [];
  const entry = worker.modelId ? models.find(model => model.id === worker.modelId || model.resolvedId === worker.modelId || model.aliases?.includes(worker.modelId ?? '')) : undefined;
  const support = modelEffort(worker.provider, entry?.resolvedId ?? worker.modelId ?? entry?.id, entry?.effort);
  const resolved = resolveEffort(worker.effort, undefined, support.capability, support.transport, support.unsupported);
  if (resolved.support === 'unsupported') return null;
  const options: SelectOption[] = [
    { value: AUTOMATIC, label: t('Tự động') },
    { value: 'low', label: t('Thấp') },
    { value: 'medium', label: t('Vừa') },
    { value: 'high', label: t('Cao') },
    { value: 'max', label: t('Tối đa') },
  ];
  return <Select
    className="composer-model-select composer-effort-select"
    size="sm"
    ariaLabel={t('Mức suy nghĩ của {0}', [worker.name])}
    value={worker.effort ?? AUTOMATIC}
    onChange={value => {
      const chosen = value === AUTOMATIC ? undefined : value as Effort;
      if (chosen !== worker.effort) onChange(chosen);
    }}
    options={options}
    showIcon={false}
    showDetail={false}
    menuMinWidth={160}
  />;
}
