---
name: SearchField
exports: SearchField
group: Forms
summary: A search box with a leading magnifier inside one bordered box, so the border and the focus state surround both.
---

## When to use

- Filtering a list or a page as the person types.
- The field at the top of a picker that drives a list of options.

## When not to

- A plain text value in a form: use `Input`.
- A magnifier beside an `Input` in your own wrapper: the ring then surrounds the field only. Use this instead.

## Example

```tsx
import { SearchField } from '@codepawlhq/orglet-ui';

<SearchField
  aria-label="Search templates"
  placeholder="Name, description, tag or author"
  value={query}
  onChange={event => setQuery(event.target.value)}
/>
```

## Props

### SearchField

| Prop | Type | Default | What it does |
|---|---|---|---|
| `type` | `string` | `'search'` | The input's type. Pass `'text'` with `role="combobox"` when the field drives a list. |
| `className` | `string` | | Goes on the box, applied last, so it overrides the kit's classes. |
| ...rest | `ComponentProps<'input'>` | | Reaches the `<input>`: `value`, `onChange`, `placeholder`, `autoFocus`, `aria-*`, `onKeyDown`. |

## Accessibility

- The kit does not invent a name. Pass `aria-label`, or wrap the field in a `<label>`.
- The magnifier is decorative and `aria-hidden`.
- Focus shows on the box: its hairline takes the focus colour with a soft halo. In forced colours the input keeps its own outline.
