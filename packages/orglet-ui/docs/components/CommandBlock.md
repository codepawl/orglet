---
name: CommandBlock
exports: CommandBlock
group: Display
summary: A command to paste into a terminal, on a quiet card with a copy button.
---

## When to use

- A command people copy: an install line, a setup step.
- A small control that changes the command, such as a terminal picker: put it in `toolbar`.
- A long command in a narrow column: it breaks only after a path separator or a space, never inside a word.

## When not to

- Code to read, not run: use a plain code block.
- A file: use `Attachment`.
- A value with a copy button inside a tooltip: use a row of `InfoTip` with `onCopy`.

## Example

```tsx
import { CommandBlock, showToast } from '@codepawlhq/orglet-ui';

<CommandBlock
  label="Install"
  command="npx @codepawlhq/orglet"
  copyLabel="Copy command"
  onCopy={async command => {
    await navigator.clipboard.writeText(command);
    showToast('Copied');
  }}
/>
```

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| `command` | `string` | required | The command shown, and the text `onCopy` receives. |
| `copyLabel` | `string` | required | The copy button's accessible name and tooltip. |
| `onCopy` | `(command: string) => void` | required | Writes the command to the clipboard. The component never touches it. |
| `label` | `ReactNode` | | A short title above the card. |
| `toolbar` | `ReactNode` | | Fills the card's top bar on the left. The copy button then sits at the bar's right. |
| `copyIcon` | `ReactNode` | two sheets | Replaces the copy icon. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

## Accessibility

- The copy button is a real button named by `copyLabel`. Its icon is `aria-hidden`.
- The command sits in a `<code>` element. What is copied is the plain command, not the markup that lets it wrap.
- Say what happened after copying, for example with `showToast`, since the component stays silent.
