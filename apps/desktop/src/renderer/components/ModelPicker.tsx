import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Hash, RefreshCw } from 'lucide-react';
import type { Worker } from '../../shared/contracts';
import { CATALOG_HINT_IDS, type ModelEntry, type ModelListResult } from '../../shared/models';
import { deprecationNotice, formatSunsetDay, pickerListedModel } from '../../shared/modelDeprecation';
import { currentLocale, t, tMessage } from '../i18n';
import { orglet } from '../api';
import { Button, FieldLabel } from './ui';
import { ModelMark } from './ProviderMark';
import { modelRunnable, openCodeModelIssue } from './openCodeModel';
import { checkedChoiceValue, modelChoices, type ModelChoice } from '../../shared/modelChoices';
import { choiceBadge, choiceLabel, shownChoices } from './modelRows';
import { isOpenCodePlan } from '../../shared/opencode';
import { Input, Skeleton } from '@codepawlhq/orglet-ui';
import { modelLists } from '../caches';
import { modelIdRequired, startingModelId } from './workerModel';
import { useCached } from '../prefetch';

function deprecationChipLabel(sunsetAt?: string) {
  const day = formatSunsetDay(sunsetAt, currentLocale());
  return day ? t('Sắp ngừng · {0}', [day]) : t('Sắp ngừng');
}

type Placement = { style: CSSProperties; above: boolean };
const GAP = 6, EDGE = 10, MAX_HEIGHT = 360, MIN_HEIGHT = 140;

const emptyList = (error?: string): ModelListResult => ({
  models: [], fetchedAt: new Date().toISOString(), stale: false, customIdOk: true, source: 'catalog-hint', ...(error ? { error } : {}),
});

/** Whether the typed text narrows the list: something typed that is not already a listed ID. */
function filtering(models: readonly ModelEntry[], query: string) {
  return Boolean(query.trim()) && !models.some(entry => entry.id === query);
}

function matches(entry: ModelEntry | undefined, query: string) {
  const q = query.trim().toLowerCase();
  if (!entry) return false;
  return entry.id.toLowerCase().includes(q)
    || Boolean(entry.displayName?.toLowerCase().includes(q))
    || Boolean(entry.aliases?.some(alias => alias.toLowerCase().includes(q)));
}

/** One row of the open list: a model, or the More models row that reveals the older ones. */
type Row = { kind: 'choice'; choice: ModelChoice } | { kind: 'more' };

/**
 * Searchable list plus an always-on typed ID. Catalog rows are suggestions, never a lock. An empty field is filled
 * once per connection from the fetched list (`startingModelId`, COD-293); emptied again by the person, it stays empty.
 */
export function ModelPicker({ provider, value, onChange, invalid, flash, required }: {
  provider: Exclude<Worker['provider'], 'demo'>;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  flash?: number;
  /** The worker cannot be saved without an ID on this connection: the label carries the red asterisk. */
  required?: boolean;
}) {
  const id = useId();
  // The list is kept for the session (COD-218): a worker row resting under the pointer fetches it, and switching
  // provider back shows the earlier list at once. The core refreshes its own copy in the background when old.
  const kept = useCached(modelLists, provider);
  const [failed, setFailed] = useState<{ provider: string; list: ModelListResult }>();
  const list = kept ?? (failed?.provider === provider ? failed.list : undefined);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<Placement>();
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const hint = Object.hasOwn(CATALOG_HINT_IDS, provider) ? CATALOG_HINT_IDS[provider as keyof typeof CATALOG_HINT_IDS] : undefined;
  const models = list?.models ?? [];
  const runnable = (row: Row | undefined) => row?.kind === 'more' || (row?.kind === 'choice' && (!row.choice.entry || modelRunnable(provider, row.choice.entry.id)));
  // Rows as the composer shows them (COD-332): the maker's mark and versioned name, Default on the model that runs
  // when the field is empty (choosing it empties the field), and older models under More models. Typing narrows the
  // whole list instead.
  const choices = modelChoices(provider, models, !modelIdRequired(provider));
  const checked = checkedChoiceValue(choices, value.trim());
  const shown = shownChoices(choices, checked, moreOpen);
  const listed: Row[] = filtering(models, value)
    ? choices.filter(choice => matches(choice.entry, value)).map(choice => ({ kind: 'choice', choice }))
    : [
      ...shown.main.map((choice): Row => ({ kind: 'choice', choice })),
      ...(shown.moreRow ? [{ kind: 'more' } as const] : []),
      ...shown.more.map((choice): Row => ({ kind: 'choice', choice })),
    ];
  // Models this plan offers but Orglet cannot call stay listed, after the ones it can, so the gap is visible.
  const options = [...listed.filter(row => runnable(row)), ...listed.filter(row => !runnable(row))];
  const defaultChoice = choices.find(choice => choice.value === '' && choice.label);
  const modelIssue = openCodeModelIssue(provider, value);
  const failOpen = t('Gõ ID model. Danh sách chưa tải được.');

  /** Asks the core again; `refresh` makes it fetch from the provider rather than answer from its own copy. */
  const load = async (refresh = false) => {
    setBusy(true);
    try {
      modelLists.set(provider, await orglet.call('modelList', { provider, ...(refresh ? { refresh: true } : {}) }));
    } catch {
      setFailed({ provider, list: list ? { ...list, error: list.error ?? failOpen, customIdOk: true } : emptyList(failOpen) });
    } finally { setBusy(false); }
  };

  // Nothing kept and nothing on its way means the first read failed: say so instead of showing the shape forever.
  useEffect(() => {
    if (kept || failed?.provider === provider) return;
    let cancelled = false;
    modelLists.read(provider).catch(() => { if (!cancelled) setFailed({ provider, list: emptyList(failOpen) }); });
    return () => { cancelled = true; };
  }, [provider, kept, failed, failOpen]);
  /** Nothing kept for this provider yet and no failure to report: the list is on its way. */
  const pending = !list && failed?.provider !== provider;

  // The connection whose list already had its one chance to fill the empty field. A list that failed or came back
  // empty is no chance: the refresh button may still bring one.
  const filledFor = useRef<string>(undefined);
  useEffect(() => {
    if (!list?.models.length || filledFor.current === provider) return;
    filledFor.current = provider;
    if (value.trim()) return;
    const start = startingModelId(provider, list.models, modelId => modelRunnable(provider, modelId));
    if (start) onChange(start);
  }, [provider, list, value]);

  const close = () => { setOpen(false); setPlacement(undefined); };
  const openList = () => { setActive(Math.max(0, options.findIndex(row => row.kind === 'choice' && row.choice.value === checked))); setOpen(true); };
  const choose = (index: number) => {
    const option = options[index]; if (!option || !runnable(option)) return;
    if (option.kind === 'more') { setMoreOpen(true); return; }
    if (option.choice.value !== value) onChange(option.choice.value);
    setMoreOpen(false);
    close(); input.current?.focus();
  };
  const container = () => (input.current?.closest('[role=dialog]') as HTMLElement | null) ?? document.body;

  useLayoutEffect(() => {
    if (!open) return;
    const update = (event?: Event) => {
      const field = input.current, listbox = menu.current; if (!field || !listbox) return;
      if (event?.target instanceof Node && listbox.contains(event.target)) return;
      const rect = field.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) { close(); return; }
      const full = Math.ceil(listbox.scrollHeight + listbox.offsetHeight - listbox.clientHeight);
      const natural = Math.min(full, MAX_HEIGHT);
      const below = innerHeight - rect.bottom - GAP - EDGE, above = rect.top - GAP - EDGE;
      const placeAbove = below < natural && above > below;
      const maxHeight = Math.floor(Math.max(Math.min(natural, placeAbove ? above : below), Math.min(natural, MIN_HEIGHT)));
      const scrolls = maxHeight < full;
      const width = Math.min(Math.max(rect.width, 240), innerWidth - EDGE * 2);
      const preferred = rect.left;
      const left = Math.min(Math.max(preferred, EDGE), innerWidth - width - EDGE);
      const top = placeAbove ? rect.top - GAP - maxHeight : rect.bottom + GAP;
      const host = container();
      const origin = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
      setPlacement({ above: placeAbove, style: { position: host === document.body ? 'fixed' : 'absolute', left: left - origin.left, top: top - origin.top, width, ...(scrolls ? { maxHeight, overflowY: 'auto' } : { overflowY: 'hidden' }) } });
    };
    update();
    const observer = new ResizeObserver(() => update()); if (input.current) observer.observe(input.current);
    addEventListener('resize', update); document.addEventListener('scroll', update, true);
    return () => { observer.disconnect(); removeEventListener('resize', update); document.removeEventListener('scroll', update, true); };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!input.current?.contains(target) && !menu.current?.contains(target)) close(); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);

  useEffect(() => {
    const listbox = menu.current, item = listbox?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !listbox || !item) return;
    if (item.offsetTop < listbox.scrollTop) listbox.scrollTop = item.offsetTop - 6;
    else if (item.offsetTop + item.offsetHeight > listbox.scrollTop + listbox.clientHeight) listbox.scrollTop = item.offsetTop + item.offsetHeight - listbox.clientHeight + 6;
  }, [open, active, placement]);

  const move = (from: number, step: number) => {
    for (let next = from + step; next >= 0 && next < options.length; next += step) {
      if (runnable(options[next])) return next;
    }
    return from;
  };

  const defaultNote = isOpenCodePlan(provider)
    ? t('Chọn model trong gói hoặc gõ ID; mục Chưa hỗ trợ thì Orglet chưa gọi được.')
    : defaultChoice ? t('Gõ ID model hoặc chọn từ danh sách. Để trống thì chạy model Mặc định.')
      : t('Gõ ID model hoặc chọn từ danh sách. Tên mặc định chỉ là gợi ý.');
  const note = pending ? <Skeleton width="60%" />
    // The core's reason comes as a Vietnamese source string, like every core message.
    : modelIssue || (list?.error ? tMessage(list.error) : undefined) || (!models.length && !busy ? failOpen : undefined)
    || (list?.stale ? t('Danh sách model từ lần tải trước.') : defaultNote);
  const selected = pickerListedModel(models, value, hint);
  const notice = deprecationNotice(selected);
  const replacementId = selected?.replacementId;

  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const noteId = `${id}-note`;
  const deprecationId = `${id}-deprecation`;
  const describedBy = notice || replacementId ? `${deprecationId} ${noteId}` : noteId;

  return <div className="field">
    <span className="field-title" id={labelId}><FieldLabel icon={Hash} required={required}>{t('ID model')}</FieldLabel></span>
    <div className="model-picker">
      <div className="model-picker-field">
      <Input ref={input} data-field="modelId" value={value} maxLength={200} autoComplete="off" autoCorrect="off" spellCheck={false}
        placeholder={defaultChoice ? t('Mặc định · {0}', [choiceLabel(defaultChoice)]) : hint ?? t('Gõ ID model')}
        aria-labelledby={labelId} aria-describedby={describedBy} aria-invalid={invalid || undefined} data-flash={invalid ? flash : undefined}
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
        onChange={event => { onChange(event.target.value); if (!open && models.length) openList(); }}
        onFocus={() => { if (models.length) openList(); }}
        invalid={!!invalid} flash={flash ?? 0}
        onKeyDown={event => {
          if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
          if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key) && options.length) { event.preventDefault(); openList(); return; }
          if (!open) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => move(index, 1)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => move(index, -1)); }
          else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
          else if (event.key === 'End') { event.preventDefault(); setActive(options.length - 1); }
          else if (event.key === 'Enter' && options[active]) { event.preventDefault(); choose(active); }
        }} />
      <ChevronDown size={16} className={`model-picker-chevron${open ? ' open' : ''}`} aria-hidden="true" />
      </div>
      <Button type="button" size="icon" className="model-picker-refresh" disabled={busy || pending} aria-label={t('Làm mới danh sách model')} title={t('Làm mới danh sách model')} onClick={() => void load(true)}>
        <RefreshCw size={13} className={busy ? 'spin' : undefined} />
      </Button>
    </div>
    {(notice || replacementId) && <p id={deprecationId} className="model-picker-deprecation">
      {notice && <span className="badge model-deprecation-chip" data-chip="deprecated">{deprecationChipLabel(notice.sunsetAt)}</span>}
      {replacementId && <span className="muted">{t('Nên dùng {0}', [replacementId])}</span>}
    </p>}
    <p id={noteId} className="muted model-picker-note">{note}</p>
    {open && options.length > 0 && createPortal(<ul ref={menu} id={listId} role="listbox" aria-labelledby={labelId}
      className={`org-select-menu ${placement?.above ? 'org-select-menu-above' : ''}`} style={placement?.style ?? { position: 'fixed', visibility: 'hidden', left: 0, top: 0 }}>
      {options.map((option, index) => {
        const rowClass = `org-select-option${index === active ? ' org-select-option-active' : ''}`;
        const pointer = {
          onPointerMove: () => { if (index !== active) setActive(index); },
          onPointerDown: (event: { preventDefault: () => void }) => event.preventDefault(),
          onClick: () => choose(index),
        };
        if (option.kind === 'more') {
          return <li key="more" id={`${id}-option-${index}`} data-index={index} role="option" aria-selected={false}
            className={`${rowClass} org-select-option-spaced org-select-option-action`} {...pointer}>
            <span className="org-select-icon"><ChevronDown size={16} aria-hidden="true" /></span>
            <span className="org-select-option-text"><span>{t('Thêm model')}</span></span>
            <Check size={16} className="org-select-check" aria-hidden="true" />
          </li>;
        }
        const { choice } = option;
        const badge = choiceBadge(choice, runnable(option));
        const previous = options[index - 1];
        const firstOlder = choice.more && previous?.kind === 'choice' && !previous.choice.more;
        return <li key={choice.value || 'default'} id={`${id}-option-${index}`} data-index={index} role="option" aria-selected={choice.value === checked}
          aria-disabled={runnable(option) ? undefined : true}
          className={`${rowClass}${firstOlder ? ' org-select-option-spaced' : ''}`} {...pointer}>
          {/* The maker's mark: without it a list of names says nothing about whose models they are (user, 2026-09-19). */}
          <span className="org-select-icon"><ModelMark vendor={choice.vendor} provider={provider} /></span>
          <span className="org-select-option-text"><span>{choiceLabel(choice)}</span></span>
          {badge && <span className={`org-select-option-badge${choice.entry?.deprecated && !choice.isDefault ? ' model-deprecation-chip' : ''}`}>{badge}</span>}
          <Check size={16} className="org-select-check" aria-hidden="true" />
        </li>;
      })}
    </ul>, container())}
  </div>;
}
