import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Hash, RefreshCw } from 'lucide-react';
import type { Worker } from '../../shared/contracts';
import { CATALOG_HINT_IDS, type ModelEntry, type ModelListResult } from '../../shared/models';
import { deprecationNotice, formatSunsetDay, pickerListedModel } from '../../shared/modelDeprecation';
import { currentLocale, t } from '../i18n';
import { orglet } from '../api';
import { Button, FieldLabel } from './ui';
import { ProviderMark } from './ProviderMark';
import { fieldInvalid } from './fieldInvalid';
import { modelRunnable, openCodeModelIssue } from './openCodeModel';
import { isOpenCodePlan } from '../../shared/opencode';

function deprecationChipLabel(sunsetAt?: string) {
  const day = formatSunsetDay(sunsetAt, currentLocale());
  return day ? t('Sắp ngừng · {0}', [day]) : t('Sắp ngừng');
}

type Placement = { style: CSSProperties; above: boolean };
const GAP = 6, EDGE = 10, MAX_HEIGHT = 360, MIN_HEIGHT = 140;

const emptyList = (error?: string): ModelListResult => ({
  models: [], fetchedAt: new Date().toISOString(), stale: false, customIdOk: true, source: 'catalog-hint', ...(error ? { error } : {}),
});

function filterModels(models: ModelEntry[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q || models.some(entry => entry.id === query)) return models;
  return models.filter(entry =>
    entry.id.toLowerCase().includes(q)
    || entry.displayName?.toLowerCase().includes(q)
    || entry.aliases?.some(alias => alias.toLowerCase().includes(q)));
}

/** Searchable list plus an always-on typed ID. Catalog rows are suggestions, never a lock. */
export function ModelPicker({ provider, value, onChange, invalid, flash }: {
  provider: Exclude<Worker['provider'], 'demo'>;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  flash?: number;
}) {
  const id = useId();
  const [list, setList] = useState<ModelListResult>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<Placement>();
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const hint = Object.hasOwn(CATALOG_HINT_IDS, provider) ? CATALOG_HINT_IDS[provider as keyof typeof CATALOG_HINT_IDS] : undefined;
  const models = list?.models ?? [];
  const runnable = (entry: ModelEntry) => modelRunnable(provider, entry.id);
  // Models this plan offers but Orglet cannot call stay listed, after the ones it can, so the gap is visible.
  const matching = filterModels(models, value);
  const options = [...matching.filter(runnable), ...matching.filter(entry => !runnable(entry))];
  const modelIssue = openCodeModelIssue(provider, value);
  const failOpen = t('Gõ ID model. Danh sách chưa tải được.');

  const load = async (refresh = false) => {
    setBusy(true);
    try {
      setList(await orglet.call('modelList', { provider, ...(refresh ? { refresh: true } : {}) }));
    } catch {
      setList(previous => previous ? { ...previous, error: previous.error ?? failOpen, customIdOk: true } : emptyList(failOpen));
    } finally { setBusy(false); }
  };

  useEffect(() => {
    let cancelled = false;
    setList(undefined);
    setBusy(true);
    orglet.call('modelList', { provider }).then(result => { if (!cancelled) setList(result); }).catch(() => {
      if (!cancelled) setList(emptyList(failOpen));
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [provider, failOpen]);

  const close = () => { setOpen(false); setPlacement(undefined); };
  const openList = () => { setActive(Math.max(0, options.findIndex(entry => entry.id === value))); setOpen(true); };
  const choose = (index: number) => {
    const option = options[index]; if (!option || !runnable(option)) return;
    if (option.id !== value) onChange(option.id);
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
    ? t('Chọn model trong gói hoặc gõ ID. Model ghi Chưa hỗ trợ dùng endpoint Orglet chưa gọi được.')
    : t('Gõ ID model hoặc chọn từ danh sách. Tên mặc định chỉ là gợi ý.');
  const note = busy && !list ? t('Đang tải danh sách model…')
    : modelIssue || list?.error || (!models.length && !busy ? failOpen : undefined)
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
    <span className="field-title" id={labelId}><FieldLabel icon={Hash}>{t('ID model')}</FieldLabel></span>
    <div className="model-picker">
      <div className="model-picker-field">
      <input ref={input} data-field="modelId" value={value} maxLength={200} autoComplete="off" autoCorrect="off" spellCheck={false}
        placeholder={hint ?? t('Gõ ID model')}
        aria-labelledby={labelId} aria-describedby={describedBy} aria-invalid={invalid || undefined} data-flash={invalid ? flash : undefined}
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
        onChange={event => { onChange(event.target.value); if (!open && models.length) openList(); }}
        onFocus={() => { if (models.length) openList(); }}
        {...fieldInvalid(!!invalid, flash ?? 0)}
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
      <Button type="button" size="icon" className="model-picker-refresh" disabled={busy} aria-label={t('Làm mới danh sách model')} title={t('Làm mới danh sách model')} onClick={() => void load(true)}>
        <RefreshCw size={13} className={busy ? 'spin' : undefined} />
      </Button>
    </div>
    {(notice || replacementId) && <p id={deprecationId} className="model-picker-deprecation">
      {notice && <span className="badge model-deprecation-chip" data-chip="deprecated">{deprecationChipLabel(notice.sunsetAt)}</span>}
      {replacementId && <span className="muted">{t('Nên dùng {0}', [replacementId])}</span>}
    </p>}
    <p id={noteId} className="muted model-picker-note">{note}</p>
    {open && options.length > 0 && createPortal(<ul ref={menu} id={listId} role="listbox" aria-labelledby={labelId}
      className={`select-menu ${placement?.above ? 'above' : ''}`} style={placement?.style ?? { position: 'fixed', visibility: 'hidden', left: 0, top: 0 }}>
      {options.map((option, index) => (
        <li key={option.id} id={`${id}-option-${index}`} data-index={index} role="option" aria-selected={option.id === value}
          aria-disabled={runnable(option) ? undefined : true}
          className={`select-option${index === active ? ' active' : ''}`}
          onPointerMove={() => { if (index !== active) setActive(index); }} onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}>
          {/* The provider is the same for every row, but without its mark a list of bare slugs says nothing about
              what it belongs to (user, 2026-09-19). */}
          <ProviderMark provider={provider} size="small" decorative />
          <span className="select-option-text">
            <span>{option.displayName ?? option.id}</span>
            {option.displayName ? <span className="select-detail">{option.id}</span> : option.source === 'catalog-hint' ? <span className="select-detail">{t('Gợi ý')}</span> : null}
          </span>
          {option.deprecated && <span className="select-option-badge model-deprecation-chip">{t('Sắp ngừng')}</span>}
          {!runnable(option) && <span className="select-option-badge">{t('Chưa hỗ trợ')}</span>}
          <Check size={16} className="select-check" aria-hidden="true" />
        </li>
      ))}
    </ul>, container())}
  </div>;
}
