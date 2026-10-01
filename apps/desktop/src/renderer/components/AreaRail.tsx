import type { ReactNode } from 'react';
import { PanelLeft, Plus } from './icons';
import { t } from '../i18n';
import { Button } from './ui';
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
};

/**
 * The far-left column (COD-366), the way Discord's rail lists its servers: Home first, then the areas, then Library and
 * Schedules, which open their own panels, and one **+** that creates an orglet, a channel or a schedule. The sidebar
 * beside it shows the chosen area's list. While the sidebar is folded the rail starts with the way to open it. It has
 * no ground of its own, like the sidebar, and the open area is told by the sidebar's selected tint, never by a line.
 */
export function AreaRail({ entries, createItems, sidebarOpen, onOpenSidebar, covered = false }: {
  entries: readonly AreaRailEntry[];
  createItems: RowMenuItem[];
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  /** The sidebar lies over the rail in a narrow window, so the rail is out of reach until it closes. */
  covered?: boolean;
}) {
  return <nav className="area-rail" aria-label={t('Khu vực')} inert={covered || undefined} aria-hidden={covered || undefined}>
    {!sidebarOpen && <Button size="icon" className="area-rail-fold" aria-label={t('Mở sidebar')} title={t('Mở sidebar')} onClick={onOpenSidebar}><PanelLeft size={18} /></Button>}
    <ul className="area-rail-list">
      {entries.map(entry => <li key={entry.key}>
        <button type="button" className={`area-tile${entry.active ? ' active' : ''}`} aria-label={entry.ariaLabel ?? entry.label} title={entry.label} aria-current={entry.active ? 'page' : undefined}
          onClick={entry.onSelect} onPointerEnter={entry.onDwell ? () => entry.onDwell!(true) : undefined} onPointerLeave={entry.onDwell ? () => entry.onDwell!(false) : undefined}>
          {entry.icon}
          {entry.count ? <span className={`area-count ${entry.countTone ?? 'quiet'}`} aria-hidden="true">{entry.count > 99 ? '99+' : entry.count}</span> : null}
        </button>
      </li>)}
    </ul>
    <RowMenu label={t('Tạo mới')} icon={Plus} className="area-tile area-create" align="start" items={createItems} />
  </nav>;
}

export type { Area };
