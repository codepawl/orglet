import { createContext, useContext, useState, type PointerEvent, type ReactNode } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import { Plus } from './icons';
import { t } from '../i18n';
import { RowMenu, type RowMenuItem } from './RowMenu';
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

function Tile({ entry }: { entry: AreaRailEntry }) {
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
      onClick={() => { tip.hide(); entry.onSelect(); }} onPointerEnter={enter} onPointerLeave={leave} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) tip.show(entry.label, event.currentTarget); }} onBlur={tip.hide}>
      {entry.active && entry.activeIcon ? entry.activeIcon : entry.icon}
      {/* A dot, not a number (user, 2026-10-05): the tile's accessible name carries the count where one matters. */}
      {entry.count ? <span className={`area-dot ${entry.countTone ?? 'quiet'}`} aria-hidden="true" /> : null}
    </button>
    {entry.menuItems?.length ? <RowMenu label={t('Tùy chọn {0}', [entry.label])} className="area-tile-menu" align="start" contextMenuOf=".area-tile-slot" items={entry.menuItems} /> : null}
  </div>;
}

function FolderTiles({ folder }: { folder: AreaRailFolder }) {
  const tip = useContext(TipContext);
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
    {folder.open && <ul className="area-rail-list" aria-label={folder.label}>{folder.entries.map(entry => <li key={entry.key}><Tile entry={entry} /></li>)}</ul>}
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
export function AreaRail({ entries, spaces, createItems, onHover }: {
  /** The app's own places: Home, Activity, Library, Schedules. */
  entries: readonly AreaRailEntry[];
  /** The person's spaces and their folders, under a divider of their own (user, 2026-10-05), the way Discord parts its servers from Home. */
  spaces: readonly (AreaRailEntry | AreaRailFolder)[];
  createItems: RowMenuItem[];
  /** The pointer came over the rail or left it, so a folded sidebar can show itself for a look. */
  onHover?: (inside: boolean) => void;
}) {
  const [tip, setTip] = useState<Tip>();
  const control: TipControl = {
    show: (label, tile) => {
      const box = tile.getBoundingClientRect();
      setTip({ label, top: box.top + box.height / 2, left: box.right + TIP_GAP });
    },
    hide: () => setTip(undefined),
  };
  return <TipContext.Provider value={control}><nav className="area-rail" aria-label={t('Khu vực')} onPointerEnter={onHover ? () => onHover(true) : undefined} onPointerLeave={onHover ? () => onHover(false) : undefined} onScroll={control.hide}>
    <ul className="area-rail-list">
      {entries.map(entry => <li key={entry.key}><Tile entry={entry} /></li>)}
    </ul>
    {spaces.length > 0 && <span className="area-rail-divider" aria-hidden="true" />}
    {spaces.length > 0 && <ul className="area-rail-list" aria-label={t('Không gian')}>
      {spaces.map(entry => <li key={entry.key}>{'kind' in entry ? <FolderTiles folder={entry} /> : <Tile entry={entry} />}</li>)}
    </ul>}
    <RowMenu label={t('Tạo mới')} icon={Plus} className="area-tile area-create" align="start" items={createItems} />
    {/* The tile's accessible name already says this, so the tip is for the eye only. */}
    {tip && <div className="area-tip" aria-hidden="true" style={{ top: tip.top, left: tip.left }}>{tip.label}</div>}
  </nav></TipContext.Provider>;
}

export type { Area };
