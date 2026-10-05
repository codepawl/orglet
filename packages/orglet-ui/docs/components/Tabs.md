---
name: Tabs
exports: Tabs, TabPanel
group: Navigation
summary: Tabs on a page, as quiet text buttons, with a panel for each.
---

## When to use

- Switching between a few sections of one page or panel, where only one shows at a time.
- Tabs outside a dialog. The tabs of a settings dialog are `TabbedDialog`.

## When not to

- Going to another page or place: use links or navigation.
- A choice that changes a setting: use `RadioGroup`, or `ToolbarToggleGroup` for icons.
- More than a handful of sections: group them, or use a side list.

## Example

```tsx
import { useId, useState } from 'react';
import { TabPanel, Tabs } from '@codepawlhq/orglet-ui';

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'history', label: 'History' },
];

function Report() {
  const id = useId();
  const [value, setValue] = useState('overview');
  return <>
    <Tabs id={id} label="Report sections" tabs={tabs} value={value} onChange={setValue} />
    {tabs.map(tab => <TabPanel key={tab.id} tabsId={id} tabId={tab.id} value={value}>{tab.label}</TabPanel>)}
  </>;
}
```

## Props

`Tabs`: every `<div>` prop passes through.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `id` | `string` | | Ties the tabs to their panels. Pass the same value as `tabsId` to each `TabPanel`. |
| `label` | `string` | | Names the tab list for assistive technology. |
| `tabs` | `{ id, label, icon?, disabled? }[]` | | The tabs. `icon` is decorative. |
| `value` | `string` | | The `id` of the open tab. |
| `onChange` | `(tabId: string) => void` | | Called when a tab opens, by click or key. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

`TabPanel`: every `<div>` prop passes through.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `tabsId` | `string` | | The `id` of its `Tabs`. |
| `tabId` | `string` | | The tab this panel belongs to. |
| `value` | `string` | | The open tab. The panel is hidden unless it equals `tabId`. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

## Accessibility

- It follows the WAI-ARIA tabs pattern with automatic activation: the arrow keys, Home and End move the focus and open the tab at once, skipping a disabled tab.
- Only the open tab is in the Tab order, so Tab goes from the list to its panel.
- Each tab has `aria-controls` and each panel `aria-labelledby`, built from `id`, so they always match. A panel takes focus from Tab, so one with no focusable content can still be scrolled.
- The open tab is shown by its fill and text colour, and `aria-selected` says it to assistive technology.
