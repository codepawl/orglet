---
title: Theming
summary: Light, dark or the system's choice through one attribute, and your own look through tokens.
---

## Light and dark

`tokens.css` defines every value on `:root`. Light is the default, and `data-theme` on the root element picks
another:

- `data-theme="dark"` uses the dark palette.
- `data-theme="system"` follows the operating system through `prefers-color-scheme`.
- No attribute, or `data-theme="light"`, stays light.

```tsx
document.documentElement.dataset.theme = 'system';
```

## Make it yours

Set tokens after importing `tokens.css`. Do not override `.org-` classes: a class may change between releases, and
a token will not.

```css
:root {
  --org-accent: #0a7d5a;
  --org-radius: 6px;
}

:root[data-theme=dark] {
  --org-accent: #4fd1a5;
}
```

An application that already has its own variables hands them over once:

```css
:root {
  --org-bg: var(--background);
  --org-text: var(--foreground);
  --org-border: var(--outline);
}
```

A subtree can carry another palette by setting the tokens on its own root element.

## The tokens

| Token | What it is |
|---|---|
| `--org-bg`, `--org-surface` | The page, and a raised block on it. |
| `--org-text`, `--org-muted` | Main and secondary text. |
| `--org-border`, `--org-border-subtle` | Outlines of fields and cards. |
| `--org-row-hover`, `--org-row-active` | The wash under a hovered row, and under the chosen one. Both stay pale. |
| `--org-primary`, `--org-primary-text` | The one strong colour: a primary button, a checked box. |
| `--org-accent`, `--org-accent-ink` | The application's own colour. Not used by default. |
| `--org-success`, `--org-error`, `--org-warning`, `--org-working` | States. They carry meaning, so keep them apart in both themes. |
| `--org-focus` | The focus ring. |
| `--org-control-height`, `--org-radius`, `--org-radius-menu` | Shape. One control height keeps a row of mixed controls on one line. |
| `--org-font`, `--org-font-mono`, `--org-font-size` | Type. |
| `--org-motion-*` | Durations. All of them are zero under `prefers-reduced-motion: reduce`. |

The full list, with the values of both themes, is in `tokens.css` in the package.

## Overriding one component

Every component accepts `className` and applies it last, so one extra class is enough and `!important` is never
needed. Several looks of one component are a `variant` prop, not classes to remember.

## Reduced motion

Under `prefers-reduced-motion: reduce` the tokens set every duration to zero, so a component that animates through
them stops without any code of its own.
