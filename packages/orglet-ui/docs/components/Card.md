---
name: Card
exports: Card
group: Display
summary: A quiet rounded surface that groups content, with an optional header.
---

## When to use

- Grouping a few related things on one surface: a setting and its explanation, a summary and its actions.
- A header with a `title`, a `description` and `actions` on the right, above the content.
- `interactive` when the whole card is one thing to open.

## When not to

- Separating parts of a page: use spacing, or a quiet background. A card draws no line between its header and body, and the kit has no separator.
- Wrapping every block "to be safe": nested cards add noise, not structure.
- An interactive card that also needs its own buttons: a button cannot hold a button, so `interactive` takes no `actions`. Use a plain card with a primary action instead.

## Example

```tsx
import { Button, Card } from '@codepawlhq/orglet-ui';

<Card title="Weekly report" description="Every Monday morning" actions={<Button type="button" variant="outline">Edit</Button>}>
  Summarises last week's finished chats.
</Card>

<Card interactive title="Open the report" onClick={open}>Last run 2 hours ago</Card>
```

## Props

Every `<section>` prop passes through, or every `<button>` prop when `interactive`.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `title` | `ReactNode` | | The header's first line. It also names the card. |
| `description` | `ReactNode` | | A quieter line under the title. |
| `actions` | `ReactNode` | | Controls on the header's right, vertically centred with the title block. Not allowed with `interactive`. |
| `interactive` | `boolean` | `false` | Renders one `<button type="button">` with a hover wash and a focus ring. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

## Accessibility

- A plain card with a `title` is a `<section>` named by that title, so it is a landmark a screen reader can jump to.
- An interactive card is a button named by its title. Its content must be phrasing text, with no controls inside.
- The focus ring shows on keyboard focus only.
