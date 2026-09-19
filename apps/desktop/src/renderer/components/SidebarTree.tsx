import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { GripVertical, Archive, ArchiveRestore, EllipsisVertical, Trash } from './icons';
import { t } from '../i18n';
import { RowMenu } from './RowMenu';
import { StatusMark, type StatusMarkState } from './StatusMark';

export function statusMarkLabel(status: StatusMarkState): string {
  if (status.variant === 'busy') return t('Đang làm');
  if (status.variant === 'filled' && status.tone === 'error') return t('Cần xem lại');
  if (status.variant === 'filled') return t('Có kết quả mới');
  if (status.variant === 'dashed' && status.tone === 'error') return t('Chờ bổ sung bằng chứng');
  if (status.variant === 'dashed') return t('Đã tạm dừng');
  return t('Không có cập nhật');
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

/**
 * A team or worker row: the name opens that chat. A team lists its members in the chat details panel
 * (user, 2026-09-19), so no row expands here.
 * Optional `status` is the rolled-up mark from its subset (live thread for a worker, workers for a team).
 */
export function SidebarTreeRow({ id, name, avatar, description, active, status, onSelect, menu, reorder, arriving }: { id: string; name: string; avatar: ReactNode; description?: string; active: boolean; status?: StatusMarkState; onSelect: () => void; menu?: ReactNode; reorder: RowBindings; arriving?: boolean }) {
  const { ref, style, dragging, onMoveKey, ...pointer } = reorder;
  const mark = dragging ? <GripVertical size={14} className="disclosure-chevron" aria-hidden="true" /> : null;
  return <div ref={ref} style={style} className={`tree-item ${dragging ? 'dragging' : ''}${arriving ? ' arriving' : ''}`} {...pointer} data-row-id={id}>
    <div className="worker-row">
      {status && <StatusMark variant={status.variant} tone={status.tone} label={statusMarkLabel(status)} />}
      <span className="row-disclosure" aria-hidden="true">{mark}{avatar}</span>
      <button type="button" className={active ? 'worker active' : 'worker'} aria-current={active || undefined} title={description ? `${description}\n${t('Nhấn giữ để kéo')}` : t('Nhấn giữ để kéo')} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        onClick={onSelect} onKeyDown={onMoveKey}>
        <span>{name}</span>
      </button>
      <span data-no-drag>{menu}</span>
    </div>
  </div>;
}

export type ArchiveState = { daysLeft: number | null; tone: 'fresh' | 'aging' | 'expiring' };

/** An archived worker or team: its mark, name and days left, with Khôi phục and Xóa vĩnh viễn in its menu. */
export function ArchivedRow({ name, mark, archive, onRestore, onDelete }: { name: string; mark: ReactNode; archive: ArchiveState; onRestore: () => void; onDelete: () => void }) {
  return <div className="task-row archived-row">
    <span className="history-item">{mark}<span className="row-name">{name}</span>{archive.daysLeft !== null && <span className={`archive-age ${archive.tone}`} title={t('Tự xóa sau {0} ngày', [archive.daysLeft])}>{t('{0} ngày', [archive.daysLeft])}</span>}</span>
    <RowMenu label={t('Tùy chọn {0}', [name])} icon={EllipsisVertical} items={[{ label: t('Khôi phục'), icon: ArchiveRestore, onSelect: onRestore }, { label: t('Xóa vĩnh viễn'), icon: Trash, danger: true, onSelect: onDelete, confirm: { question: t('Xóa {0}? Cuộc trò chuyện cũ vẫn giữ lịch sử.', [name]), label: t('Xóa') } }]} />
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
