---
name: TabbedDialog
exports: TabbedDialog, TabbedFormDialog, DialogTabs, DialogTab
group: Overlays
summary: The settings layout: tabs on the left, the open section on the right, with an optional Save footer.
---

## When to use

- Settings or an editor split into sections that share one frame.
- `TabbedDialog` for changes that apply at once. With `onSubmit` and `footer`, its body forms one form.
- `TabbedFormDialog` for a form with Cancel and Save pinned at the bottom, an `error` beside them and a busy state.
- `DialogTabs` alone when you build the frame yourself.

## When not to

- One list or editor with no sections: use `Drawer`.
- One question: use `confirmAction` from `Confirm`.
- Looking at one file: use `Viewer`.
- Tabs inside a page, not a dialog: build them with `DialogTabs` and your own panel, or navigate to a page.

## Example

```tsx
import { Input, TabbedFormDialog, type DialogTab } from '@codepawlhq/orglet-ui';
import { Settings2, Shield, X } from 'lucide-react';

type SectionId = 'general' | 'access';
const tabs: DialogTab<SectionId>[] = [
  { id: 'general', label: 'General', icon: <Settings2 size={16} aria-hidden /> },
  { id: 'access', label: 'Access', icon: <Shield size={16} aria-hidden /> },
];

<TabbedFormDialog
  open={open}
  onClose={() => setOpen(false)}
  title="Orglet settings"
  closeLabel="Close"
  closeIcon={<X size={16} aria-hidden />}
  tabs={tabs}
  tab={tab}
  onTab={setTab}
  panelId="orglet-settings"
  onSubmit={save}
  submitLabel="Save"
  busyLabel="Saving"
  cancelLabel="Cancel"
  busy={saving}
  error={saveError}
>
  {tab === 'general' && <Input aria-label="Name" data-field="name" value={name} onChange={event => setName(event.target.value)} />}
</TabbedFormDialog>
```

## Props

### TabbedDialog

| Prop | Type | Default | What it does |
|---|---|---|---|
| `open` | `boolean` | required | Whether the dialog is shown. |
| `onClose` | `() => void` | required | Called on Escape, the backdrop and the close button. |
| `title` | `string` | required | The dialog's title. |
| `closeLabel` | `string` | required | The close button's accessible name. |
| `closeIcon` | `ReactNode` | required | The close button's icon. |
| `tabsLabel` | `string` | `title` | Names the tab list. |
| `tabs` | `DialogTab<T>[]` | required | The sections. |
| `tab` | `T` | required | The open tab's `id`. |
| `onTab` | `(tab: T) => void` | required | Called when another tab opens. |
| `panelId` | `string` | required | The panel's id. Each tab is `${panelId}-tab-${id}`. |
| `description` | `ReactNode` | | Under the open tab's title in the panel. |
| `actions` | `ReactNode` | | Right of the open tab's title, such as an Add button. |
| `onOpenAutoFocus` | `(event: Event) => void` | | Runs when the dialog opens, after the opener is remembered. |
| `onSubmit` | `() => void` | | Makes the body and `footer` one form with `noValidate`. Validate in it. |
| `footer` | `ReactNode` | | A row under the body. |
| `children` | `ReactNode` | required | The open section's content. |

### TabbedFormDialog

Takes the `TabbedDialog` props except `onOpenAutoFocus`, `onSubmit` and `footer`, plus:

| Prop | Type | Default | What it does |
|---|---|---|---|
| `onSubmit` | `() => void` | required | Called on Save. |
| `submitLabel` | `string` | required | The Save button's text. |
| `busyLabel` | `string` | required | The Save button's text while `busy`. |
| `cancelLabel` | `string` | required | The Cancel button's text. |
| `busy` | `boolean` | required | Disables both buttons and shows `busyLabel`. |
| `error` | `string` | | A message beside the buttons, announced as an alert. |
| `focusField` | `string` | | The `data-field` to focus when the dialog opens, scrolled into view. |
| `fieldsClassName` | `string` | | Classes for the box the fields sit in. |

### DialogTabs

| Prop | Type | Default | What it does |
|---|---|---|---|
| `label` | `string` | required | Names the tab list. |
| `tabs` | `DialogTab<T>[]` | required | The tabs. |
| `value` | `T` | required | The open tab's `id`. |
| `onChange` | `(tab: T) => void` | required | Called when another tab opens. |
| `panelId` | `string` | required | The id of the panel the tabs control. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

### DialogTab

| Prop | Type | Default | What it does |
|---|---|---|---|
| `id` | `T extends string` | required | The tab's identifier. |
| `label` | `string` | required | The tab's text and the panel's heading. |
| `icon` | `ReactNode` | | Sits left of the label. |
| `buttonProps` | `Omit<ComponentProps<'button'>, 'id' \| 'role' \| 'type' \| 'onClick' \| 'tabIndex' \| 'children'>` | | Props for the tab's button, such as a handler that prefetches on hover. |

## Accessibility

- Tabs follow the WAI-ARIA tabs pattern: arrow keys move to the next tab and open it, and only the open tab is in the Tab order.
- The panel is a `tabpanel` labelled by its tab.
- A tab's icon sits left of its label.
- Focus returns to what opened the dialog. Escape closes an open menu inside first.
- Fields on hidden tabs are unmounted, so validate in `onSubmit` and open the tab at fault. The footer error is `role="alert"`.
- The close X belongs here because the dialog is centred on the screen.
