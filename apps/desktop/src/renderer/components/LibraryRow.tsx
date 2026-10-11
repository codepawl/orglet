import type { ReactNode } from 'react';
import { RowMenu, type RowMenuItem } from './RowMenu';

/**
 * One Library entry with its row menu beside it. The entry itself is a button, and a button cannot hold another, so
 * the menu sits next to it; right-clicking anywhere on the row opens the same menu.
 */
export function LibraryRow({ menuLabel, items, children }: { menuLabel: string; items: RowMenuItem[]; children: ReactNode }) {
  return <div className="library-row">
    {children}
    <RowMenu label={menuLabel} contextMenuOf=".library-row" items={items} />
  </div>;
}
