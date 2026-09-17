import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useId } from 'react';
import { ChevronRight, GripVertical, MessageSquare, Pencil, SlidersHorizontal, ArrowUpRight, CheckCheck, X, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import { RowMenu } from './RowMenu';

const storageKey = (id: string) => `orglet.sidebar.tree.${id}.open`;
function readOpen(id: string) {
  try { return localStorage.getItem(storageKey(id)) === '1'; } catch { return false; }
}

const HOLD_MS = 350, SLOP_PX = 6;
type RowBindings = { ref: (element: HTMLElement | null) => void; style?: CSSProperties; dragging: boolean; onPointerDown: (event: PointerEvent<HTMLElement>) => void; onPointerMove: (event: PointerEvent<HTMLElement>) => void; onPointerUp: (event: PointerEvent<HTMLElement>) => void; onPointerCancel: () => void; onClickCapture: (event: React.MouseEvent) => void; onMoveKey: (event: KeyboardEvent) => void };

/**
 * Press-and-hold reordering for one sidebar list. Holding a row lifts it; moving the pointer slides the other rows
 * aside, and releasing commits the new order. Alt+Arrow keys do the same from the keyboard.
 */
export function useReorder(ids: string[], commit: (ids: string[]) => void) {
  const [override, setOverride] = useState<string[] | null>(null);
  const order = override ?? ids;
  const elements = useRef(new Map<string, HTMLElement>());
  const press = useRef<{ id: string; x: number; y: number; timer: number; pointer: number; target: HTMLElement } | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{ id: string; from: number; target: number; offset: number; tops: number[]; heights: number[]; step: number } | null>(null);

  // Once the saved order arrives from the core, drop the optimistic copy.
  useEffect(() => { if (override && override.join() === ids.join()) setOverride(null); }, [ids, override]);
  useEffect(() => {
    if (!drag) return;
    const cancel = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setDrag(null); suppressClick.current = true; } };
    document.body.classList.add('is-reordering');
    addEventListener('keydown', cancel, true);
    return () => { document.body.classList.remove('is-reordering'); removeEventListener('keydown', cancel, true); };
  }, [drag !== null]);

  const apply = (next: string[]) => { if (next.join() === order.join()) return; setOverride(next); commit(next); };
  const clearPress = () => { if (press.current) window.clearTimeout(press.current.timer); press.current = null; };

  const bind = (id: string): RowBindings => {
    const index = order.indexOf(id);
    let style: CSSProperties | undefined;
    if (drag) {
      if (id === drag.id) style = { transform: `translateY(${drag.offset}px)` };
      else if (drag.from < drag.target && index > drag.from && index <= drag.target) style = { transform: `translateY(${-drag.step}px)` };
      else if (drag.from > drag.target && index < drag.from && index >= drag.target) style = { transform: `translateY(${drag.step}px)` };
    }
    return {
      ref: element => { if (element) elements.current.set(id, element); else elements.current.delete(id); },
      style, dragging: drag?.id === id,
      onPointerDown: event => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('input,[data-no-drag]')) return;
        clearPress();
        const target = event.currentTarget;
        const timer = window.setTimeout(() => {
          const rects = order.map(item => elements.current.get(item)?.getBoundingClientRect());
          if (rects.some(rect => !rect)) return;
          const tops = rects.map(rect => rect!.top), heights = rects.map(rect => rect!.height);
          const from = order.indexOf(id);
          const gap = order.length > 1 ? Math.max(0, (from + 1 < order.length ? tops[from + 1] - tops[from] - heights[from] : tops[from] - tops[from - 1] - heights[from - 1])) : 0;
          try { target.setPointerCapture(press.current!.pointer); } catch { /* pointer already released */ }
          setDrag({ id, from, target: from, offset: 0, tops, heights, step: heights[from] + gap });
        }, HOLD_MS);
        press.current = { id, x: event.clientX, y: event.clientY, timer, pointer: event.pointerId, target };
      },
      onPointerMove: event => {
        if (!drag && press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > SLOP_PX) clearPress();
        if (!drag || drag.id !== id || !press.current) return;
        const offset = event.clientY - press.current.y;
        const centre = drag.tops[drag.from] + drag.heights[drag.from] / 2 + offset;
        let target = drag.from;
        while (target + 1 < order.length && centre > drag.tops[target + 1] + drag.heights[target + 1] / 2) target++;
        while (target > 0 && centre < drag.tops[target - 1] + drag.heights[target - 1] / 2) target--;
        setDrag({ ...drag, offset, target });
      },
      onPointerUp: () => {
        clearPress();
        if (!drag || drag.id !== id) return;
        suppressClick.current = true;
        const next = [...order]; next.splice(drag.from, 1); next.splice(drag.target, 0, id);
        setDrag(null); apply(next);
      },
      onPointerCancel: () => { clearPress(); setDrag(null); },
      onClickCapture: event => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } },
      onMoveKey: event => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        const to = index + (event.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= order.length) return;
        const next = [...order]; next.splice(index, 1); next.splice(to, 0, id); apply(next);
      },
    };
  };
  return { order, bind, dragging: drag !== null };
}

/** Text field for renaming, opened from a row menu; Enter or leaving the field saves, Escape cancels. */
function RenameField({ name, label, onSave, onDone }: { name: string; label: string; onSave: (name: string) => void; onDone: () => void }) {
  const cancelled = useRef(false);
  return <input className="row-rename" defaultValue={name} maxLength={120} aria-label={label} autoFocus onFocus={event => event.currentTarget.select()}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.blur(); }
    }}
    onBlur={event => { const next = event.currentTarget.value.trim(); if (!cancelled.current && next !== name) onSave(next); onDone(); }} />;
}

/**
 * A team or worker row that can open to show what belongs to it. The avatar turns into a chevron on hover,
 * like project folders in ChatGPT; selecting the name still picks the team or worker for the next task.
 */
export function SidebarTreeRow({ id, name, avatar, description, active, onSelect, expandLabel, menu, reorder, children }: { id: string; name: string; avatar: ReactNode; description?: string; active: boolean; onSelect: () => void; expandLabel: string; menu: ReactNode; reorder: RowBindings; children: ReactNode }) {
  const [open, setOpen] = useState(() => readOpen(id));
  const toggle = () => setOpen(value => {
    try { localStorage.setItem(storageKey(id), value ? '0' : '1'); } catch { /* storage unavailable: keep in memory only */ }
    return !value;
  });
  const { ref, style, dragging, onMoveKey, ...pointer } = reorder;
  return <div ref={ref} style={style} className={`tree-item ${open ? 'open' : ''} ${dragging ? 'dragging' : ''}`} {...pointer}>
    <div className="worker-row">
      <button type="button" className="row-disclosure" aria-expanded={open} aria-controls={`tree-${id}`} aria-label={expandLabel} title={expandLabel} onClick={toggle}>
        {dragging ? <GripVertical size={14} className="disclosure-chevron" aria-hidden="true" /> : <ChevronRight size={14} className="disclosure-chevron" aria-hidden="true" />}{avatar}
      </button>
      <button type="button" className={active ? 'worker active' : 'worker'} aria-current={active || undefined} title={description ? `${description}
${t('Nhấn giữ để kéo')}` : t('Nhấn giữ để kéo')} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        aria-expanded={open} aria-controls={`tree-${id}`} onClick={() => { onSelect(); toggle(); }} onKeyDown={onMoveKey}><span>{name}</span></button>
      <span data-no-drag>{menu}</span>
    </div>
    <div id={`tree-${id}`} className="tree-children" role="group" aria-label={name} hidden={!open || dragging}>{children}</div>
  </div>;
}

/** A task link with a menu to rename it; clearing the name shows the first message again. */
export type ArchiveState = { daysLeft: number | null; tone: 'fresh' | 'aging' | 'expiring' };
export function TaskRow({ title, brief, active, nested, askFirst, status, statusLabel, archive, onOpen, onRename, onEdit, onArchive, onDelete }: { title?: string; brief: string; active: boolean; nested?: boolean; askFirst?: boolean; status: string; statusLabel: string; archive?: ArchiveState; onOpen: (dontAskAgain?: boolean) => void; onRename: (title: string) => void; onEdit: () => void; onArchive: (archived: boolean) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const name = title ?? brief;
  if (nested) return <TaskLink name={name} status={status} statusLabel={statusLabel} askFirst={Boolean(askFirst)} onOpen={onOpen} />;
  if (editing) return <div className={`history-item editing ${nested ? 'nested' : ''}`}><MessageSquare size={nested ? 15 : 16} aria-hidden="true" /><RenameField name={name} label={t('Tên mới cho công việc {0}', [name])} onSave={onRename} onDone={() => setEditing(false)} /></div>;
  return <div className={`task-row ${active ? 'active' : ''}`}>
    <button className={`history-item ${nested ? 'nested' : ''} ${active ? 'active' : ''}`} aria-current={active || undefined} onClick={() => onOpen()}>
    <MessageSquare size={nested ? 15 : 16} /><span>{name}</span>{archive ? archive.daysLeft !== null && <span className={`archive-age ${archive.tone}`} title={t('Tự xóa sau {0} ngày', [archive.daysLeft])}>{t('{0} ngày', [archive.daysLeft])}</span> : <span className={`status-dot ${status}`} title={statusLabel} aria-label={statusLabel} />}
    </button>
    <RowMenu label={t('Tùy chọn công việc {0}', [name])} items={archive
      ? [{ label: t('Khôi phục'), icon: ArchiveRestore, onSelect: () => onArchive(false) }, { label: t('Xóa vĩnh viễn'), icon: Trash2, danger: true, onSelect: onDelete, confirm: { question: t('Xóa công việc này? Không thể hoàn tác.'), label: t('Xóa') } }]
      : [{ label: t('Chỉnh sửa'), icon: SlidersHorizontal, onSelect: onEdit }, { label: t('Đổi tên'), icon: Pencil, onSelect: () => setEditing(true) }, { label: t('Lưu trữ'), icon: Archive, onSelect: () => onArchive(true) }, { label: t('Xóa'), icon: Trash2, danger: true, onSelect: onDelete, confirm: { question: t('Xóa công việc này? Không thể hoàn tác.'), label: t('Xóa') } }]} />
  </div>;
}

/**
 * A task listed under a worker: a plain link to the task (an arrow shows on hover), edited only from the Công việc list.
 * With `askFirst`, a small popover beside the row asks before leaving (user decision 2026-09-17: not a centred dialog):
 * open, open and stop asking, or stay. It closes on Escape, outside click or focus leaving it.
 */
function TaskLink({ name, status, statusLabel, askFirst, onOpen }: { name: string; status: string; statusLabel: string; askFirst: boolean; onOpen: (dontAskAgain?: boolean) => void }) {
  const [position, setPosition] = useState<CSSProperties>();
  const link = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (restoreFocus = false) => { setPosition(undefined); if (restoreFocus) link.current?.focus(); };
  useEffect(() => {
    if (!position) return;
    popover.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: Event) => { if (!popover.current?.contains(event.target as Node) && !link.current?.contains(event.target as Node)) close(); };
    const dismiss = () => close();
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); };
  }, [position]);
  const click = () => {
    if (!askFirst) { onOpen(); return; }
    if (position) { close(); return; }
    // Beside the row, kept inside the window.
    const rect = link.current!.getBoundingClientRect();
    setPosition({ left: Math.min(rect.right + 8, innerWidth - 228), top: Math.max(8, Math.min(rect.top - 6, innerHeight - 176)) });
  };
  const choose = (open: boolean, dontAskAgain = false) => { close(!open); if (open) onOpen(dontAskAgain); };
  return <>
    <button ref={link} type="button" className="tree-leaf task-link" aria-haspopup={askFirst ? 'dialog' : undefined} aria-expanded={askFirst ? Boolean(position) : undefined} aria-controls={position ? id : undefined} onClick={click}>
      <MessageSquare size={15} aria-hidden="true" /><span>{name}</span><span className={`status-dot ${status}`} title={statusLabel} aria-label={statusLabel} /><ArrowUpRight size={14} className="task-link-arrow" aria-hidden="true" />
    </button>
    {position && <div ref={popover} id={id} className="row-menu-popover open-task-popover" role="dialog" aria-label={t('Mở công việc này?')} style={position}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(true); } }}
      onBlur={event => { if (!popover.current?.contains(event.relatedTarget as Node | null)) close(); }}>
      <p className="open-task-question">{t('Mở công việc này?')}</p>
      <button type="button" onClick={() => choose(true)}><ArrowUpRight size={16} aria-hidden="true" /><span>{t('Mở')}</span></button>
      <button type="button" onClick={() => choose(true, true)}><CheckCheck size={16} aria-hidden="true" /><span>{t('Mở, không hỏi lại')}</span></button>
      <button type="button" onClick={() => choose(false)}><X size={16} aria-hidden="true" /><span>{t('Không')}</span></button>
    </div>}
  </>;
}

/** An archived worker or team: its mark, name and days left, with Khôi phục and Xóa vĩnh viễn in its menu. */
export function ArchivedRow({ name, mark, archive, onRestore, onDelete }: { name: string; mark: ReactNode; archive: ArchiveState; onRestore: () => void; onDelete: () => void }) {
  return <div className="task-row archived-row">
    <span className="history-item">{mark}<span className="row-name">{name}</span>{archive.daysLeft !== null && <span className={`archive-age ${archive.tone}`} title={t('Tự xóa sau {0} ngày', [archive.daysLeft])}>{t('{0} ngày', [archive.daysLeft])}</span>}</span>
    <RowMenu label={t('Tùy chọn {0}', [name])} items={[{ label: t('Khôi phục'), icon: ArchiveRestore, onSelect: onRestore }, { label: t('Xóa vĩnh viễn'), icon: Trash2, danger: true, onSelect: onDelete, confirm: { question: t('Xóa {0}? Công việc cũ vẫn giữ lịch sử.', [name]), label: t('Xóa') } }]} />
  </div>;
}

/** Collapsible "Đã lưu trữ (N)" list at the end of a sidebar section. */
export function ArchivedList({ count, children }: { count: number; children: ReactNode }) {
  if (!count) return null;
  return <details className="archived-tasks"><summary><Archive size={15} aria-hidden="true" />{t('Đã lưu trữ ({0})', [count])}</summary>{children}</details>;
}

/** Shows the first few children, with a quiet control to reveal the rest. */
export function ShowMore<T>({ items, limit = 5, render, empty }: { items: T[]; limit?: number; render: (item: T) => ReactNode; empty: string }) {
  const [all, setAll] = useState(false);
  if (!items.length) return <p className="tree-empty">{empty}</p>;
  const shown = all ? items : items.slice(0, limit);
  return <>
    {shown.map(render)}
    {items.length > limit && <button type="button" className="tree-more" onClick={() => setAll(value => !value)}>{all ? t('Thu gọn') : t('Xem thêm {0}', [items.length - limit])}</button>}
  </>;
}
