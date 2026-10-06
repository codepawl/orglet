---
name: ReactionBar
exports: ReactionBar, ReactionPicker, ReactionBadges, ReactionBadge, ReactionOption
group: Display
summary: Reactions thrown at one message: a trigger with a floating row of faces, and badges on the bubble's corner.
---

## When to use

- Letting people react to a message with an emoji from a small set.
- `ReactionBar` for the trigger that opens the row, in a message's action bar.
- `ReactionBadges` for the reactions a message wears, on the bubble's corner.
- `ReactionPicker` alone when you place the floating row yourself.

## When not to

- Free emoji input or a full emoji keyboard: build that in the application.
- A rating or a vote that is stored with a meaning: use `ToolbarToggleGroup` or `Select`.
- Storing reactions: the kit does not. The application stores and counts them.

## Example

```tsx
import { ReactionBadges, ReactionBar, type ReactionBadge, type ReactionOption } from '@codepawlhq/orglet-ui';
import { SmilePlus } from 'lucide-react';

type Reaction = 'like' | 'laugh' | 'think';

const options: ReactionOption<Reaction>[] = [
  { name: 'like', emoji: '👍', meaning: 'Like' },
  { name: 'laugh', emoji: '😂', meaning: 'Laugh' },
  { name: 'think', emoji: '🤔', meaning: 'Think' },
];

const badges: ReactionBadge<Reaction>[] = [
  { name: 'like', emoji: '👍', count: 2, mine: true, label: 'Like, from you and Maya' },
];

<ReactionBar options={options} picked={mine} onPick={toggleReaction} label="React" icon={<SmilePlus size={16} aria-hidden />} />
<ReactionBadges badges={badges} align="end" onPick={toggleReaction} />
```

## Props

### ReactionBar

| Prop | Type | Default | What it does |
|---|---|---|---|
| `options` | `readonly ReactionOption<Name>[]` | required | The set to offer. |
| `picked` | `Name` | | The reaction this person already left. It shows pressed. |
| `onPick` | `(name: Name) => void` | required | Called with the picked name, or with the picked one again to take it off. |
| `label` | `string` | required | Names the trigger and the row. |
| `icon` | `ReactNode` | required | What the trigger shows. |

### ReactionPicker

The floating row itself.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `options` | `readonly ReactionOption<Name>[]` | required | The set to offer. |
| `picked` | `Name` | | The pressed one. |
| `label` | `string` | required | Names the group. |
| `onPick` | `(name: Name) => void` | required | Called with the picked name. |

### ReactionBadges

The parent needs `position: relative`. It renders nothing when `badges` is empty.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `badges` | `readonly ReactionBadge<Name>[]` | required | The reactions on the message. |
| `align` | `'start' \| 'end' \| 'inline'` | required | The corner: `start` (left) for the person's own right-aligned bubble, `end` for an answer, `inline` in the flow for a list with no bubble. |
| `onPick` | `(name: Name) => void` | required | Called on a click. One this person left takes it off, any other adds or switches to it. |

### ReactionOption

| Prop | Type | Default | What it does |
|---|---|---|---|
| `name` | `Name extends string` | required | What is stored. |
| `emoji` | `string` | required | What is drawn. |
| `meaning` | `string` | required | Names it for assistive technology and the tooltip. |

### ReactionBadge

| Prop | Type | Default | What it does |
|---|---|---|---|
| `name` | `Name extends string` | required | What is stored. |
| `emoji` | `string` | required | What is drawn. |
| `count` | `number` | required | How many left it. Shown only above one. |
| `mine` | `boolean` | required | Whether this person is among them. Sets `aria-pressed`. |
| `label` | `string` | required | A label naming everyone, read by assistive technology. |

## Accessibility

- The trigger has `aria-haspopup` and `aria-expanded`. Escape closes the row and returns focus to the trigger.
- Each option and each badge is a button with `aria-pressed`, named by its `meaning` or `label`. The emoji and count are `aria-hidden`.
- The row floats above the trigger instead of pushing other actions sideways.
- A pointer outside closes the row.
