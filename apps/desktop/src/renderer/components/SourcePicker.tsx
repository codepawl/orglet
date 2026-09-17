import { useEffect, useRef, useState } from 'react';
import { FileText, FolderOpen, Plus } from 'lucide-react';
import { Button } from './ui';
import { t } from '../i18n';

/** One entry point for adding sources; files and folder intake stay separate choices inside the menu. */
export function SourcePicker({ onFiles, onFolder }: { onFiles: () => void; onFolder: () => void }) {
  const [open, setOpen] = useState(false);
  const [openBelow, setOpenBelow] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const choose = (fn: () => void) => { setOpen(false); fn(); };
  const toggle = () => {
    if (!open) setOpenBelow(!hasRoomAbove(trigger.current));
    setOpen(!open);
  };
  return <div className="source-picker" ref={root} onBlur={event => { if (open && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const items = [...root.current!.querySelectorAll<HTMLButtonElement>('[role=menuitem]')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  }}>
    <Button ref={trigger} type="button" size="icon" className="composer-add" aria-label={t('Thêm nguồn')} title={t('Thêm nguồn')} aria-haspopup="menu" aria-expanded={open} onClick={toggle}><Plus size={20} /></Button>
    {open && <div className={openBelow ? 'source-menu below' : 'source-menu'} role="menu" aria-label={t('Thêm nguồn')}>
      <button type="button" role="menuitem" onClick={() => choose(onFiles)}><FileText size={16} /><span><strong>{t('Tệp')}</strong><small>{t('Chọn từng file cụ thể')}</small></span></button>
      <button type="button" role="menuitem" onClick={() => choose(onFolder)}><FolderOpen size={16} /><span><strong>{t('Thư mục')}</strong><small>{t('Tự lấy tối đa 20 file hỗ trợ')}</small></span></button>
    </div>}
  </div>;
}

/** Room the menu needs above the button: two items and its padding. */
const MENU_HEIGHT = 130;

/**
 * Whether the menu fits above the button inside the nearest scrolling area. On the new-task screen the composer sits
 * near the top of a scrolling panel, which would cut off a menu that opens upward.
 */
function hasRoomAbove(button: HTMLElement | null) {
  if (!button) return true;
  const buttonTop = button.getBoundingClientRect().top;
  let container = button.parentElement;
  while (container) {
    const overflow = getComputedStyle(container).overflowY;
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') break;
    container = container.parentElement;
  }
  const containerTop = container ? container.getBoundingClientRect().top : 0;
  return buttonTop - containerTop >= MENU_HEIGHT;
}
