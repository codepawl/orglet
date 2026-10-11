import { useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { ModelVendor } from '../../shared/modelChoices';
import { numberedRowIndex, sidePanelSide } from '../../shared/model-menu';
import { t } from '../i18n';
import { AnchoredPopover } from './AnchoredPopover';
import { ModelMark } from './ProviderMark';
import { MessageBoxFocus } from './SourcePicker';
import { Button } from './ui';

/** One model of the menu, ready to draw: the parent decides the name, the badge and whether it can run. */
export type ModelMenuRow = {
  value: string;
  label: string;
  vendor: ModelVendor | undefined;
  badge?: string;
  disabled?: boolean;
};

const SIDE_PANEL_WIDTH = 240;
const WINDOW_EDGE = 12;
const MENU_PADDING = 6;

/**
 * The model chip on the prompt bar and the menu it opens (owner, 2026-10-11, after Claude's own model menu): the
 * plan allowance of the harness behind the chat at the top, then the current models numbered 1 to 9, then a More
 * models row that opens the older ones in a panel beside the menu. Props in, choice out: the parent owns the model
 * lists, what a model is called, and what choosing one saves.
 *
 * Keys: arrows move, Enter chooses, 1 to 9 choose a row of the main list, Arrow Right on More models goes into the
 * side panel, Arrow Left or Escape goes back, Escape on the main list closes the menu. Hovering or focusing More
 * models opens its panel.
 */
export function ModelMenu({ ariaLabel, currentLabel, provider, checked, mainRows, currentOutsideMain, sideRows, onSelect }: {
  ariaLabel: string;
  /** The checked model's name, which the chip shows. */
  currentLabel: string;
  provider: ComponentProps<typeof ModelMark>['provider'];
  /** The value of the checked row, in either list. */
  checked: string;
  mainRows: readonly ModelMenuRow[];
  /** The checked model when it is not in the main list (it is in the side panel, or typed by hand): shown after the main rows. */
  currentOutsideMain?: ModelMenuRow;
  sideRows: readonly ModelMenuRow[];
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sidePlacement, setSidePlacement] = useState<{ side: 'right' | 'left'; top: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const mainList = useRef<HTMLDivElement>(null);
  const moreRow = useRef<HTMLButtonElement>(null);
  const sidePanel = useRef<HTMLDivElement>(null);
  const moveIntoSide = useRef(false);
  const focusMessageBox = useContext(MessageBoxFocus);
  const hasSide = sideRows.length > 0;
  const sideOpen = sidePlacement !== undefined;

  const closeSide = () => setSidePlacement(undefined);
  const close = () => {
    setOpen(false);
    closeSide();
  };
  // The popover focuses its first control once placed; the keyboard should start on the checked model, as in a radio group.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const start = mainList.current?.querySelector<HTMLButtonElement>('[tabindex="0"]');
      start?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const openSide = (moveInto: boolean) => {
    const row = moreRow.current;
    const popover = root.current?.parentElement;
    if (!row || !popover) return;
    moveIntoSide.current = moveInto;
    if (sideOpen) {
      if (moveInto) focusFirstSideRow();
      return;
    }
    const side = sidePanelSide({ menuRight: popover.getBoundingClientRect().right, panelWidth: SIDE_PANEL_WIDTH, windowWidth: innerWidth, edge: WINDOW_EDGE });
    setSidePlacement({ side, top: row.offsetTop - MENU_PADDING });
  };
  const focusFirstSideRow = () => {
    sidePanel.current?.querySelector<HTMLButtonElement>('[role=menuitemradio]')?.focus({ preventScroll: true });
  };
  // The panel sits level with the More models row, moved up when the window has no room below it, and scrolls when taller than the window.
  useLayoutEffect(() => {
    const panel = sidePanel.current;
    const popover = root.current?.parentElement;
    if (!sidePlacement || !panel || !popover) return;
    const popoverTop = popover.getBoundingClientRect().top;
    const roomBelow = innerHeight - WINDOW_EDGE - (popoverTop + sidePlacement.top);
    const overflow = Math.max(0, panel.offsetHeight - roomBelow);
    const lowestTop = WINDOW_EDGE - popoverTop;
    panel.style.top = `${Math.max(lowestTop, sidePlacement.top - overflow)}px`;
    if (moveIntoSide.current) {
      moveIntoSide.current = false;
      focusFirstSideRow();
    }
  }, [sidePlacement]);

  const choose = (row: ModelMenuRow) => {
    if (row.disabled) return;
    close();
    if (focusMessageBox) focusMessageBox();
    else trigger.current?.focus();
    if (row.value !== checked) onSelect(row.value);
  };

  const itemsOf = (list: HTMLElement | null) => [...(list?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio], [role=menuitem]') ?? [])];
  const moveFocus = (list: HTMLElement | null, step: number | 'first' | 'last') => {
    const all = itemsOf(list);
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (step === 'first') next = 0;
    else if (step === 'last') next = all.length - 1;
    else next = (index + step + all.length) % all.length;
    all[next]?.focus();
  };
  const backToMainList = () => {
    // Focus first: closing the panel while a row of it has focus would read as leaving the menu.
    moreRow.current?.focus();
    closeSide();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const inSide = sidePanel.current?.contains(event.target as Node) ?? false;
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      const index = numberedRowIndex(event.key, mainRows.length);
      if (index !== undefined) {
        event.preventDefault();
        choose(mainRows[index]);
        return;
      }
    }
    if (inSide && (event.key === 'Escape' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      // Escape here goes back one level; the popover would otherwise close the whole menu.
      event.stopPropagation();
      backToMainList();
      return;
    }
    if (!inSide && event.key === 'ArrowRight' && document.activeElement === moreRow.current) {
      event.preventDefault();
      openSide(true);
      return;
    }
    const moves: Record<string, number | 'first' | 'last'> = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' };
    if (event.key in moves) {
      event.preventDefault();
      moveFocus(inSide ? sidePanel.current : mainList.current, moves[event.key]);
    }
  };

  const focusStop = checked === currentOutsideMain?.value ? currentOutsideMain.value : mainRows.some(row => row.value === checked) ? checked : mainRows[0]?.value;
  const renderRow = (row: ModelMenuRow, number: number | undefined, inMain: boolean) => <Button key={row.value} type="button" variant="ghost"
    role="menuitemradio" aria-checked={row.value === checked} aria-disabled={row.disabled || undefined}
    tabIndex={inMain ? (row.value === focusStop ? 0 : -1) : -1} aria-keyshortcuts={number === undefined ? undefined : String(number)}
    className="model-option" data-model={row.value}
    onClick={() => choose(row)} onFocus={inMain ? closeSide : undefined} onPointerEnter={inMain ? closeSide : undefined}>
    <ModelMark vendor={row.vendor} provider={provider} />
    <span className="model-option-text">
      <span className="model-option-name">{row.label}{row.badge && <span className="model-option-badge">{row.badge}</span>}</span>
    </span>
    <Check size={15} aria-hidden="true" className="model-option-check" />
    {number !== undefined && <kbd className="model-option-key" aria-hidden="true">{number}</kbd>}
  </Button>;

  return <>
    <Button ref={trigger} type="button" variant="ghost" className="composer-model-select composer-model-trigger"
      aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(current => !current)}>
      <span className="composer-model-name">{currentLabel}</span>
      <ChevronDown size={14} className="composer-model-chevron" aria-hidden="true" />
    </Button>
    <AnchoredPopover anchor={trigger} open={open} onClose={close} label={ariaLabel} className="model-menu">
      <div ref={root} className="model-menu-body" onKeyDown={onKeyDown}
        onBlur={event => {
          const next = event.relatedTarget as Node | null;
          // A click on plain text in the menu blurs to nothing; only focus moving to another control leaves it.
          const movedOut = next !== null && !root.current?.contains(next) && next !== trigger.current;
          if (movedOut) close();
        }}>
        <div ref={mainList} role="menu" aria-label={ariaLabel} className="model-menu-list">
          {mainRows.map((row, index) => renderRow(row, index < 9 ? index + 1 : undefined, true))}
          {currentOutsideMain && renderRow(currentOutsideMain, undefined, true)}
          {hasSide && <Button ref={moreRow} type="button" variant="ghost" role="menuitem" aria-haspopup="menu" aria-expanded={sideOpen}
            tabIndex={-1} className="model-option model-option-more" data-model-more
            onClick={() => (sideOpen ? closeSide() : openSide(false))} onPointerEnter={() => openSide(false)} onFocus={() => openSide(false)}>
            <span className="model-option-icon-gap" aria-hidden="true" />
            <span className="model-option-text"><span className="model-option-name">{t('Thêm model')}</span></span>
            <ChevronRight size={16} aria-hidden="true" className="model-option-chevron" />
          </Button>}
        </div>
        {sidePlacement && <div ref={sidePanel} role="menu" aria-label={t('Thêm model')} className="model-menu-side" data-side={sidePlacement.side}
          style={{ width: SIDE_PANEL_WIDTH, top: sidePlacement.top }}>
          {sideRows.map(row => renderRow(row, undefined, false))}
        </div>}
      </div>
    </AnchoredPopover>
  </>;
}
