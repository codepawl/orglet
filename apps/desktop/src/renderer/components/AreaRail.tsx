import type { ReactNode } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import { Plus } from './icons';
import { t } from '../i18n';
import { RowMenu, type RowMenuItem } from './RowMenu';
import type { Area } from '../areas';

/**
 * One button on the area rail: an icon in a rounded tile, named by its tooltip and accessible name, with a count of
 * what waits there. An `accent` count waits for the person, a `quiet` one is only news.
 */
export type AreaRailEntry = {
  key: string;
  icon: ReactNode;
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

function Tile({ entry }: { entry: AreaRailEntry }) {
  return <div className="area-tile-slot">
    <button type="button" className={`area-tile${entry.active ? ' active' : ''}`} aria-label={entry.ariaLabel ?? entry.label} title={entry.label} aria-current={entry.active ? 'page' : undefined}
      onClick={entry.onSelect} onPointerEnter={entry.onDwell ? () => entry.onDwell!(true) : undefined} onPointerLeave={entry.onDwell ? () => entry.onDwell!(false) : undefined}>
      {entry.icon}
      {entry.count ? <span className={`area-count ${entry.countTone ?? 'quiet'}`} aria-hidden="true">{entry.count > 99 ? '99+' : entry.count}</span> : null}
    </button>
    {entry.menuItems?.length ? <RowMenu label={t('Tùy chọn {0}', [entry.label])} className="area-tile-menu" align="start" contextMenuOf=".area-tile-slot" items={entry.menuItems} /> : null}
  </div>;
}

function FolderTiles({ folder }: { folder: AreaRailFolder }) {
  const waiting = folder.entries.reduce((total, entry) => total + (entry.count ?? 0), 0);
  const holdsOpenPage = folder.entries.some(entry => entry.active);
  return <div className={`area-folder${folder.open ? ' open' : ''}`}>
    <div className="area-tile-slot">
      <button type="button" className={`area-tile area-folder-tile${!folder.open && holdsOpenPage ? ' active' : ''}`} aria-expanded={folder.open} aria-label={folder.label} title={folder.label} onClick={folder.onToggle}>
        {folder.open ? <FolderOpen size={20} /> : <Folder size={20} />}
        {!folder.open && waiting ? <span className="area-count quiet" aria-hidden="true">{waiting > 99 ? '99+' : waiting}</span> : null}
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
 * Spaces can sit in folders (user, 2026-10-05): a folder is an outlined group with its own tile, which opens and closes it.
 */
export function AreaRail({ entries, createItems, onHover }: {
  entries: readonly (AreaRailEntry | AreaRailFolder)[];
  createItems: RowMenuItem[];
  /** The pointer came over the rail or left it, so a folded sidebar can show itself for a look. */
  onHover?: (inside: boolean) => void;
}) {
  return <nav className="area-rail" aria-label={t('Khu vực')} onPointerEnter={onHover ? () => onHover(true) : undefined} onPointerLeave={onHover ? () => onHover(false) : undefined}>
    <ul className="area-rail-list">
      {entries.map(entry => <li key={entry.key}>{'kind' in entry ? <FolderTiles folder={entry} /> : <Tile entry={entry} />}</li>)}
    </ul>
    <RowMenu label={t('Tạo mới')} icon={Plus} className="area-tile area-create" align="start" items={createItems} />
  </nav>;
}

export type { Area };
