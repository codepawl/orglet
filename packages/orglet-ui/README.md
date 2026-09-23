# @codepawl/orglet-ui

The interface Orglet is built from: a small set of components and the tokens they read.

It is not published yet. This package exists so components can be moved out of the app one at a time, under a
contract, instead of being untangled in one go on the day someone wants to use them. The app still imports its own
`apps/desktop/src/renderer/components`; a component moves here only when it meets the rules below, and the app then
imports it from here.

## What belongs here

A component belongs here when it would make sense in an application that is not Orglet. A worker avatar, a status
circle, a select: yes. A harness row, a chat composer, the details panel: no, those are Orglet.

Judge it by its dependencies rather than by its name. If a component needs Orglet's contracts, its IPC bridge, or a
token like `--sidebar`, it is not general yet, and forcing it here only moves the problem.

## The rules a component here follows

1. **Its own file of styles, beside it**, imported by the component. No shared stylesheet, no rule that reaches
   across components.
2. **Every class starts with `org-`.** A host application has class names too, and the kit does not get to own
   `.row` or `.card`.
3. **Colours, radii and timings come from `--org-` tokens**, each with a fallback at the use site, so a page that
   forgets `tokens.css` still renders something sane. See [src/styles/tokens.css](src/styles/tokens.css).
4. **Text comes in as props.** No translation call inside a component: the kit cannot ship Orglet's Vietnamese
   strings, and an application already knows how it translates. Where a control needs a name for assistive
   technology, take it as a prop and make it required.
5. **`className` is accepted and applied last**, so an application can override anything without `!important`.
   Several looks of one component are `variant` props, not classes the caller has to know.
6. **Keyboard and assistive technology are part of the component**, not something the caller adds: roles, labels,
   focus handling, and a visible focus ring.
7. **Reduced motion is honoured.** The tokens flatten every duration under `prefers-reduced-motion`, so a component
   that animates through them needs nothing extra. A component that animates by hand handles it itself.

## What is still missing

The kit is deliberately thin today. Before it can be published it needs at least the controls an application cannot
do without: `Input`, `Textarea`, `Label`, `Card`, `Badge`, `Dialog`, and a real `Tooltip`. After those: `Tabs`
outside a dialog, `RadioGroup`, `Progress`, `Table`.

`Skeleton` is here already, and it is the only shape a wait may take: a bar where text will be, a block where a
picture will be, a circle where a face will be, sweeping under a second per pass and still under reduced motion.
The kit has no spinner and will not grow one.

Two things it will not grow: a `Separator` and the alert with a coloured left border. Orglet separates with spacing,
grouping and a quiet background instead, and that rule travels with the kit.

## Licence

AGPL-3.0-only for now, the same as the repository. A more permissive licence for this package is a decision to make
deliberately before it is published, not a default to drift into.
