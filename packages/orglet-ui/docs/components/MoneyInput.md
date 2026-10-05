---
name: MoneyInput
exports: MoneyInput
group: Forms
summary: A field for an amount of money, with the currency symbol before it and its code after it.
---

## When to use

- A budget, a price or a limit the person types as a number.
- When the currency should be visible but not editable: pass `symbol` and `code`.

## When not to

- Plain text or a number that is not money: use `Input`.
- Choosing a currency: use `Select`.
- Converting or validating the amount: that is the application's job, the field keeps the text as typed.

## Example

```tsx
import { FieldLabel, MoneyInput } from '@codepawlhq/orglet-ui';
import { Wallet } from 'lucide-react';

<label>
  <FieldLabel icon={Wallet}>Budget per day</FieldLabel>
  <MoneyInput value={budget} onChange={setBudget} symbol="$" code="USD" invalid={budgetError} flash={failedSubmits} />
</label>
```

## Props

Every `<input>` prop except `value` and `onChange` passes through to the input.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `value` | `string` | required | The text as typed. |
| `onChange` | `(value: string) => void` | required | Called with the new text, not an event. |
| `symbol` | `string` | required | Drawn before the number, such as "$". |
| `code` | `string` | required | Drawn after the number, such as "USD". |
| `invalid` | `boolean` | | Sets `aria-invalid` and a red border. |
| `flash` | `number` | | A counter that replays the shake. Only used with `invalid`. |
| `className` | `string` | | Applied last, on the wrapper. |

## Accessibility

- Name it with a `<label>` around it or `aria-label`. The symbol and code are `aria-hidden`.
- The input uses `inputMode="decimal"`, so touch keyboards show a number pad.
- Say the currency in the label if it is not obvious, since assistive technology does not read the code.
