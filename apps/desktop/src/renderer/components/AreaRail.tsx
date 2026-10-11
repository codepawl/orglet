import { createContext, useContext, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Folder, FolderOpen } from 'lucide-react';
import { Tooltip } from '@codepawlhq/orglet-ui';
import { PanelLeft, Plus } from './icons';
import { Button } from './ui';
import { t } from '../i18n';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { useReorder } from './SidebarTree';
import type { Area } from '../areas';

/**
 * One button on the area rail: an icon in a rounded tile, named by its tooltip and accessible name, with a count of
 * what waits there, shown as a dot. An `accent` count waits for the person, a `quiet` one is only news.
 */
export type AreaRailEntry = {
  key: string;
  icon: ReactNode;
  /** The filled drawing shown while this is the open area; without one the outline stays. */
  activeIcon?: ReactNode;
  label: string;
  ariaLabel?: string;
  active: boolean;
  count?: number;
  countTone?: 'accent' | 'quiet';
  onSelect: () => void;
  onDwell?: (resting: boolean) => void;
  /** What a right click on the tile offers; the same items open from the keyboard on the tile's own small trigger. */
  menuItems?: RowMenuItem[];
};

/** Tiles gathered under one folder, the way Discord folds servers: open it shows them, closed it is one tile. */
export type AreaRailFolder = {
  kind: 'folder';
  key: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  entries: AreaRailEntry[];
  menuItems: RowMenuItem[];
};

/** The name shown beside the tile under the pointer, and where: the rail scrolls, so the tip is placed on the window. */
type Tip = { label: string; top: number; left: number };
type TipControl = { show: (label: string, tile: HTMLElement) => void; hide: () => void };
const TipContext = createContext<TipControl>({ show: () => {}, hide: () => {} });

/** The gap between a tile and its name. */
const TIP_GAP = 10;

/** What a tile takes from the list it can be dragged in: Alt+Arrow moves it from the keyboard. */
type TileMove = (event: KeyboardEvent<HTMLElement>) => void;

function Tile({ entry, onMoveKey }: { entry: AreaRailEntry; onMoveKey?: TileMove }) {
  const tip = useContext(TipContext);
  // A folded sidebar already shows what the tile lists while the pointer rests on it, so the name stays out of its way.
  const enter = (event: PointerEvent<HTMLButtonElement>) => {
    if (entry.onDwell) entry.onDwell(true);
    else tip.show(entry.label, event.currentTarget);
  };
  const leave = () => {
    entry.onDwell?.(false);
    tip.hide();
  };
  return <div className="area-tile-slot">
    <button type="button" className={`area-tile${entry.active ? ' active' : ''}`} aria-label={entry.ariaLabel ?? entry.label} data-name={entry.label} aria-current={entry.active ? 'page' : undefined}
      onClick={() => { tip.hide(); entry.onSelect(); }} onKeyDown={onMoveKey} onPointerEnter={enter} onPointerLeave={leave} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) tip.show(entry.label, event.currentTarget); }} onBlur={tip.hide}>
      {entry.active && entry.activeIcon ? entry.activeIcon : entry.icon}
      {/* A dot, not a number (user, 2026-10-05): the tile's accessible name carries the count where one matters. */}
      {entry.count ? <span className={`area-dot ${entry.countTone ?? 'quiet'}`} aria-hidden="true" /> : null}
    </button>
    {entry.menuItems?.length ? <RowMenu label={t('Tùy chọn {0}', [entry.label])} className="area-tile-menu" align="start" contextMenuOf=".area-tile-slot" items={entry.menuItems} /> : null}
  </div>;
}

function FolderTiles({ folder, onReorder }: { folder: AreaRailFolder; onReorder: (keys: string[]) => void }) {
  const tip = useContext(TipContext);
  const inside = useReorder(folder.entries.map(entry => entry.key), onReorder);
  const waiting = folder.entries.reduce((total, entry) => total + (entry.count ?? 0), 0);
  const holdsOpenPage = folder.entries.some(entry => entry.active);
  return <div className={`area-folder${folder.open ? ' open' : ''}`}>
    <div className="area-tile-slot">
      <button type="button" className={`area-tile area-folder-tile${!folder.open && holdsOpenPage ? ' active' : ''}`} aria-expanded={folder.open} aria-label={folder.label} data-name={folder.label} onClick={() => { tip.hide(); folder.onToggle(); }}
        onPointerEnter={event => tip.show(folder.label, event.currentTarget)} onPointerLeave={tip.hide} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) tip.show(folder.label, event.currentTarget); }} onBlur={tip.hide}>
        {folder.open ? <FolderOpen size={20} /> : <Folder size={20} />}
        {!folder.open && waiting ? <span className="area-dot quiet" aria-hidden="true" /> : null}
      </button>
      <RowMenu label={t('Tùy chọn thư mục {0}', [folder.label])} className="area-tile-menu" align="start" contextMenuOf=".area-tile-slot" items={folder.menuItems} />
    </div>
    {folder.open && <ul className="area-rail-list" aria-label={folder.label}>{inside.order.flatMap(key => folder.entries.filter(entry => entry.key === key)).map(entry => {
      const { ref, style, dragging, onMoveKey, ...pointer } = inside.bind(entry.key);
      // The folder's own list is dragged apart from the rail's: the press must not also lift the folder.
      return <li key={entry.key} ref={ref} style={style} className={dragging ? 'area-dragging' : undefined} {...pointer} onPointerDown={event => { event.stopPropagation(); pointer.onPointerDown(event); }}><Tile entry={entry} onMoveKey={onMoveKey} /></li>;
    })}</ul>}
  </div>;
}

/**
 * The far-left column (COD-366), the way Discord's rail lists its servers: Home first, then the areas, then Library and
 * Schedules, which open as pages in the main panel, and one **+** that creates an orglet, a channel or a schedule. The sidebar
 * beside it shows the chosen area's list. While the sidebar is folded the rail starts with the way to open it. It has
 * no ground of its own, unlike the sidebar's card, and the open area is told by the sidebar's selected tint, never by a line.
 * A tile's name shows beside it while the pointer is on it (user, 2026-10-05), the way Discord names a server.
 * Spaces can sit in folders (user, 2026-10-05): a folder is an outlined group with its own tile, which opens and closes it.
 */
export function AreaRail({ entries, spaces, onReorderSpaces, onCreateSpace, onHover, onOpenSidebar, trail }: {
  /** The app's own places: Home, Activity, Library, Schedules. */
  entries: readonly AreaRailEntry[];
  /** The person's spaces and their folders, under a divider of their own (user, 2026-10-05), the way Discord parts its servers from Home. */
  spaces: readonly (AreaRailEntry | AreaRailFolder)[];
  /**
   * Holding a space's tile lifts it, and dropping it gives every space's key in the new order (owner, 2026-10-11). A
   * folder moves as one tile with the spaces in it; a space inside a folder moves among that folder's spaces.
   */
  onReorderSpaces: (spaceKeys: string[]) => void;
  /** The **+** under the spaces makes a space and nothing else (user, 2026-10-05): the rail lists spaces, so that is what it adds. */
  onCreateSpace: () => void;
  /** Back and forward along the places the person has been (user, 2026-10-05), at the top of the rail the way Discord has them. */
  trail: { back: boolean; forward: boolean; onTravel: (step: -1 | 1) => void };
  /** The pointer came over the rail or left it, so a folded sidebar can show itself for a look. */
  onHover?: (inside: boolean) => void;
  /** Given while the sidebar is folded: the rail then starts with the button that pins it open, so the list is never hidden without a way back. */
  onOpenSidebar?: () => void;
}) {
  const [tip, setTip] = useState<Tip>();
  const spaceKeysUnder = (key: string, insideFolder?: { key: string; keys: string[] }) => {
    const item = spaces.find(entry => entry.key === key);
    if (!item) return [];
    if (!('kind' in item)) return [item.key];
    return insideFolder?.key === item.key ? insideFolder.keys : item.entries.map(entry => entry.key);
  };
  const rail = useReorder(spaces.map(entry => entry.key), keys => onReorderSpaces(keys.flatMap(key => spaceKeysUnder(key))));
  const reorderInFolder = (folderKey: string, keys: string[]) => onReorderSpaces(rail.order.flatMap(key => spaceKeysUnder(key, { key: folderKey, keys })));
  const control: TipControl = {
    show: (label, tile) => {
      const box = tile.getBoundingClientRect();
      setTip({ label, top: box.top + box.height / 2, left: box.right + TIP_GAP });
    },
    hide: () => setTip(undefined),
  };
  return <TipContext.Provider value={control}><nav className="area-rail" aria-label={t('Khu vực')} onPointerEnter={onHover ? () => onHover(true) : undefined} onPointerLeave={onHover ? () => onHover(false) : undefined} onScroll={control.hide}>
    {onOpenSidebar && <Tooltip label={t('Mở sidebar')} side="bottom">
      {/* The pointer on this button is about to open the sidebar for good, so it does not also slide the look out under the tooltip. */}
      <Button size="icon" className="area-open-sidebar" aria-label={t('Mở sidebar')} onClick={onOpenSidebar}
        onPointerEnter={() => onHover?.(false)} onPointerLeave={() => onHover?.(true)}><PanelLeft size={18} /></Button>
    </Tooltip>}
    <div className="area-trail">
      <Tooltip label={t('Quay lại')}><span className="tooltip-anchor"><button type="button" className="area-trail-step" aria-label={t('Quay lại')} disabled={!trail.back} onClick={() => trail.onTravel(-1)}><ArrowLeft size={16} /></button></span></Tooltip>
      <Tooltip label={t('Tiến tới')}><span className="tooltip-anchor"><button type="button" className="area-trail-step" aria-label={t('Tiến tới')} disabled={!trail.forward} onClick={() => trail.onTravel(1)}><ArrowRight size={16} /></button></span></Tooltip>
    </div>
    <ul className="area-rail-list">
      {entries.map(entry => <li key={entry.key}><Tile entry={entry} /></li>)}
    </ul>
    {spaces.length > 0 && <span className="area-rail-divider" aria-hidden="true" />}
    {spaces.length > 0 && <ul className="area-rail-list" aria-label={t('Không gian')}>
      {rail.order.flatMap(key => spaces.filter(entry => entry.key === key)).map(entry => {
        const { ref, style, dragging, onMoveKey, ...pointer } = rail.bind(entry.key);
        return <li key={entry.key} ref={ref} style={style} className={dragging ? 'area-dragging' : undefined} {...pointer}>
          {'kind' in entry ? <FolderTiles folder={entry} onReorder={keys => reorderInFolder(entry.key, keys)} /> : <Tile entry={entry} onMoveKey={onMoveKey} />}
        </li>;
      })}
    </ul>}
    <button type="button" className="area-tile area-create" aria-label={t('Tạo không gian')} data-name={t('Tạo không gian')} onClick={() => { control.hide(); onCreateSpace(); }}
      onPointerEnter={event => control.show(t('Tạo không gian'), event.currentTarget)} onPointerLeave={control.hide} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) control.show(t('Tạo không gian'), event.currentTarget); }} onBlur={control.hide}>
      <Plus size={20} />
    </button>
    {/* The tile's accessible name already says this, so the tip is for the eye only. */}
    {tip && <div className="area-tip" aria-hidden="true" style={{ top: tip.top, left: tip.left }}>{tip.label}</div>}
  </nav></TipContext.Provider>;
}

export type { Area };
