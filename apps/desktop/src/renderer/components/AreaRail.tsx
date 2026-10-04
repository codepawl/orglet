import type { ReactNode } from 'react';
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
};

/**
 * The far-left column (COD-366), the way Discord's rail lists its servers: Home first, then the areas, then Library and
 * Schedules, which open as pages in the main panel, and one **+** that creates an orglet, a channel or a schedule. The sidebar
 * beside it shows the chosen area's list. While the sidebar is folded the rail starts with the way to open it. It has
 * no ground of its own, unlike the sidebar's card, and the open area is told by the sidebar's selected tint, never by a line.
 */
export function AreaRail({ entries, createItems, onHover }: {
  entries: readonly AreaRailEntry[];
  createItems: RowMenuItem[];
  /** The pointer came over the rail or left it, so a folded sidebar can show itself for a look. */
  onHover?: (inside: boolean) => void;
}) {
  return <nav className="area-rail" aria-label={t('Khu vực')} onPointerEnter={onHover ? () => onHover(true) : undefined} onPointerLeave={onHover ? () => onHover(false) : undefined}>
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
