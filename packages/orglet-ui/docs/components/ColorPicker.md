---
name: ColorPicker
exports: ColorPicker, normalizeHex, ColorPickerLabels, ColorPickerProps
group: Forms
summary: A colour panel with an area, a hue slider, a hex field, presets and the person's saved colours.
---

## When to use

- Choosing a custom colour, beside a row of preset swatches, inside a popover.
- Letting a person keep their own colours: it shows `saved` swatches with a way to save the current one and remove any.
- `normalizeHex` to check text a person typed: it returns a lowercase `#rrggbb`, or `undefined`.

## When not to

- A handful of fixed colours as icons in a toolbar: use `ToolbarToggleGroup`.
- A choice from a named list: use `Select`.
- Free text: use `Input`.

## Example

```tsx
import { AnchoredPopover, Button, ColorPicker, normalizeHex, type ColorPickerLabels } from '@codepawlhq/orglet-ui';

const labels: ColorPickerLabels = {
  panel: 'Colour',
  area: 'Saturation and brightness',
  areaValue: (saturation, brightness) => `Saturation ${saturation}%, brightness ${brightness}%`,
  hue: 'Hue',
  hex: 'Hex colour',
  save: 'Save',
  presets: 'Presets',
  saved: 'Saved',
  presetColor: color => `Use ${color}`,
  savedColor: color => `Use saved ${color}`,
  removeColor: color => `Remove ${color}`,
  removeTitle: 'Remove from saved',
  done: 'Done',
};

<Button ref={anchor} type="button" onClick={() => setOpen(true)}>Colour</Button>
<AnchoredPopover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Colour">
  <ColorPicker
    value={color}
    onChange={setColor}
    presets={['#e5484d', '#3e63dd', '#30a46c']}
    saved={savedColors}
    onSave={hex => setSavedColors([...savedColors, hex])}
    onRemove={hex => setSavedColors(savedColors.filter(item => item !== hex))}
    onClose={() => setOpen(false)}
    labels={labels}
  />
</AnchoredPopover>
```

## Props

### ColorPicker

Takes `ColorPickerProps`.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `value` | `string` | required | The current colour as `#rrggbb`. |
| `onChange` | `(hex: string) => void` | required | Called live as the colour changes, with a lowercase `#rrggbb`. |
| `presets` | `readonly string[]` | required | Swatches offered as presets. |
| `saved` | `readonly string[]` | required | The person's saved colours. The section is hidden when empty. |
| `onSave` | `(hex: string) => void` | required | Called by the save button. It is disabled when the colour is already saved. |
| `onRemove` | `(hex: string) => void` | required | Called to remove a saved colour. |
| `onClose` | `() => void` | required | Called by the done button and by Escape. |
| `labels` | `ColorPickerLabels` | required | Every string the picker shows or announces. |
| `id` | `string` | | Set on the panel. |

### ColorPickerLabels

| Prop | Type | Default | What it does |
|---|---|---|---|
| `panel` | `string` | required | Names the whole panel. |
| `area` | `string` | required | Names the saturation and brightness area. |
| `areaValue` | `(saturation: number, brightness: number) => string` | required | What the area announces, from whole percentages. |
| `hue` | `string` | required | Names the hue slider. |
| `hex` | `string` | required | Names the hex field. |
| `save` | `string` | required | The save button's text. |
| `presets` | `string` | required | Title of the presets section. |
| `saved` | `string` | required | Title of the saved section. |
| `presetColor` | `(color: string) => string` | required | Names a preset swatch. |
| `savedColor` | `(color: string) => string` | required | Names a saved swatch. |
| `removeColor` | `(color: string) => string` | required | Names a saved swatch's remove button. |
| `removeTitle` | `string` | required | The remove button's tooltip. |
| `done` | `string` | required | The done button's text. |

### normalizeHex

`normalizeHex(text: string): string | undefined`. It trims the text, drops a leading `#`, lowercases it, and returns `#rrggbb` when that is six hex digits.

## Accessibility

- The area is a `slider`: arrow keys move it, Shift makes bigger steps, and `areaValue` is its spoken value.
- The hue is a native range input. The hex field is a text input with its own name.
- Swatches are buttons with `aria-pressed`, and the picked one also shows a tick, so colour is not the only sign.
- It sets `data-popup-open`, so Escape closes the panel and not a dialog around it.
- Every string comes in `labels`, so the application passes them in its own language.
