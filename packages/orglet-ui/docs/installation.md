---
title: Installation
summary: Add the package, import the tokens once, then use the components.
---

## Requirements

- React 19. `react` and `react-dom` are peer dependencies.
- A bundler that handles CSS imports, as Vite does out of the box. Each component imports its own stylesheet.
- The package ships ES modules with type declarations. There is no CommonJS build.

## Install

```sh
pnpm add @codepawlhq/orglet-ui
```

`npm install @codepawlhq/orglet-ui` and `yarn add @codepawlhq/orglet-ui` work the same way.

## Import the tokens once

Every colour, radius and timing a component reads is an `--org-` custom property. Import them in the application's
entry file, before your own styles:

```tsx
import '@codepawlhq/orglet-ui/tokens.css';
```

## Use a component

```tsx
import { useState } from 'react';
import { SwitchField } from '@codepawlhq/orglet-ui';

export function ReportSetting() {
  const [weekly, setWeekly] = useState(true);
  return <SwitchField checked={weekly} onChange={setWeekly} description="Every Monday morning">Weekly report</SwitchField>;
}
```

A component's styles come with it: `Switch` imports `Switch.css`, so an application that only uses the switch only
loads the switch's styles.

## Things to render once

Two components are mounted once, near the root, and then driven by a function call from anywhere:

```tsx
import { Confirmer, Toaster } from '@codepawlhq/orglet-ui';

<Toaster icons={{ success: <CheckIcon />, error: <AlertIcon />, info: <InfoIcon /> }} />
<Confirmer confirmLabel="Confirm" cancelLabel="Cancel" />
```

After that, `showToast('Saved')` shows a message and `await confirmAction({ title: 'Delete this file?' })` asks a
question.

## Text and icons are yours

The kit translates nothing and ships no icon set. Every label, including the ones a screen reader hears, comes in
as a prop, and icons are passed as elements. The examples use [lucide-react](https://lucide.dev), and any icon
component works.

## Licence

AGPL-3.0-only, the same as the [Orglet repository](https://github.com/codepawl/orglet).
