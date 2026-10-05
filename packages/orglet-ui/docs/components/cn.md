---
name: cn
exports: cn
group: Utilities
summary: Joins class names and lets the caller's class win over the kit's.
---

## When to use

- Combining class names, with conditions, in your own components.
- Overriding a kit component's styles: every component ends its class list with the `className` it was given, and `cn` resolves conflicts the same way.

## When not to

- Inline styles: use the `style` prop where a component offers one.
- Theming: change the `--org-` tokens instead of overriding classes one by one.

## Example

```tsx
import { Button, cn } from '@codepawlhq/orglet-ui';

<Button type="button" className={cn('wide', isActive && 'active')}>Export</Button>
```

## Props

`cn(...inputs: ClassValue[]): string`. It takes the same inputs as `clsx` (strings, arrays, objects of conditions, falsy values) and merges conflicting utility classes, with the later one winning.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `...inputs` | `ClassValue[]` | | Class names, arrays, condition objects or falsy values. |

## Accessibility

- It only builds a class string and has no effect on semantics.
- Overriding classes can hide a focus ring or lower contrast. Keep both when you restyle.
