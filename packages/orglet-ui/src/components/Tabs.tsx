import { type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import './Tabs.css';

export type TabItem = {
  id: string;
  label: string;
  /** A small decorative icon before the label. */
  icon?: ReactNode;
  disabled?: boolean;
};

const tabElementId = (tabsId: string, tabId: string) => `${tabsId}-tab-${tabId}`;
const panelElementId = (tabsId: string, tabId: string) => `${tabsId}-panel-${tabId}`;

/**
 * Tabs outside a dialog, following the WAI-ARIA tabs pattern with automatic activation: the arrow keys, Home and End
 * move the focus and open the tab at once, and only the open tab is in the Tab order, so Tab goes on to its panel.
 * A tab is a quiet text button; the open one takes the text colour on a subtle fill, the others rest muted. There is
 * no track, no underline and no line under the list.
 *
 * `id` ties the tabs to their `TabPanel`s: pass the same value as `tabsId` there. `label` names the tab list.
 */
export function Tabs({ id, label, tabs, value, onChange, className, ...props }: Omit<ComponentProps<'div'>, 'onChange' | 'role' | 'id'> & {
  id: string;
  label: string;
  tabs: readonly TabItem[];
  value: string;
  onChange: (tabId: string) => void;
}) {
  const enabledTabs = tabs.filter(tab => !tab.disabled);
  const reachableId = enabledTabs.some(tab => tab.id === value) ? value : enabledTabs[0]?.id;

  function openTab(tabId: string) {
    onChange(tabId);
    document.getElementById(tabElementId(id, tabId))?.focus();
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, tabId: string) {
    const position = enabledTabs.findIndex(tab => tab.id === tabId);
    const last = enabledTabs.length - 1;
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = position === last ? 0 : position + 1;
    if (event.key === 'ArrowLeft') next = position === 0 ? last : position - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    if (next === undefined) return;
    event.preventDefault();
    openTab(enabledTabs[next].id);
  }

  return <div {...props} role="tablist" aria-label={label} className={cn('org-tabs', className)}>
    {tabs.map(tab => {
      const selected = tab.id === value;
      return <button key={tab.id} type="button" role="tab" id={tabElementId(id, tab.id)} aria-selected={selected}
        aria-controls={panelElementId(id, tab.id)} disabled={tab.disabled} tabIndex={tab.id === reachableId ? 0 : -1}
        className="org-tab" onClick={() => onChange(tab.id)} onKeyDown={event => moveFocus(event, tab.id)}>
        {tab.icon && <span className="org-tab-icon" aria-hidden="true">{tab.icon}</span>}
        {tab.label}
      </button>;
    })}
  </div>;
}

/**
 * The content of one tab. Render one per tab: it carries the `id` and `aria-labelledby` that match its tab and hides
 * itself unless `value` (the open tab) is its `tabId`. It takes focus from the Tab key, so a panel with nothing
 * focusable in it can still be reached and scrolled.
 */
export function TabPanel({ tabsId, tabId, value, className, children, ...props }: Omit<ComponentProps<'div'>, 'role' | 'id'> & {
  /** The `id` of the `Tabs` this panel belongs to. */
  tabsId: string;
  tabId: string;
  /** The open tab, the same value `Tabs` has. */
  value: string;
}) {
  return <div tabIndex={0} {...props} role="tabpanel" id={panelElementId(tabsId, tabId)} aria-labelledby={tabElementId(tabsId, tabId)}
    hidden={tabId !== value} className={cn('org-tab-panel', className)}>
    {children}
  </div>;
}
