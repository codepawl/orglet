# House rules

Design rules for the Orglet desktop app UI. They apply to every change.

Reading map:

- Look and feel
- Layout and panels
- Rows and lists
- Forms and controls
- States and feedback
- Motion
- Text and language
- Alignment check

## Look and feel

- ChatGPT-like, calm product UI. No admin-dashboard look, no neon, no gradients as brand.
- Icons sit left of text: field labels, action buttons, agent and provider marks.
- Never use eyebrow labels (small caption above a heading) or coloured left-border callouts.
- Never draw horizontal divider lines: no `<hr>`, no border-top or border-bottom between rows, headers, footers, tabs or table rows. Separate with spacing, grouping or a subtle background.
- Hover labels are the kit's `Tooltip`, not `title=` attributes.

## Layout and panels

- Panels are rounded cards. The sidebar and the main area have rounded corners and sit apart on the window background, not flush to the window edge.
- Nothing sits in a panel's corner. A control near the end of a rounded panel stays at least `--panel-inset` (= `--panel-radius`) away so it is past the curve. Two rounded shapes a few pixels apart read as curves fighting. That is why the sidebar's top and bottom padding is the inset and why the details close button starts lower.
- Inside a pill-shaped control (the composer), a secondary control is shorter than the primary one so it clears the pill's curve.
- The sidebar is resizable by dragging its inner edge, and the picked width is remembered.
- The side list always belongs to what the main panel shows, never to the area left behind.
- A place reached from the navigation opens as a page in the main panel, not as a dialog.
- Stacked blocks keep room between them: about 8px between rows of a group, 12 to 16px between groups, set by gap or margin and never by a divider line. `scripts/alignment/rules.ts` flags a disclosure row, code block, list, control or surface that sits under 4px from the block above it (`cramped`); mark an intended tight stack with `data-align-ignore="cramped"`.
- A close (X) button belongs only to a dialog in the middle of the screen. Panels, pages and columns are left by navigating elsewhere or by the toggle that opened them.
- Controls in one column share a width (settings selects and money inputs are 210px).
- A parent and its children are separated by a larger gap than siblings are from each other.
- A description sits directly under its title, never as a separate paragraph further down.
- Right-hand controls in a row are vertically centred on the text block beside them.
- App chrome (buttons, rows, panels, labels) is not text-selectable; only content people copy is.
- Scrollbars are styled once globally in `styles.css`. Never add per-component `scrollbar-width` or `scrollbar-color`: it switches Chromium back to the plain bar.

## Rows and lists

- Hover is a lighter tint than selected (`--row-hover` vs `--row-active`). Both stay pale; the pair must be told apart at a glance without either reading as a filled block.
- A background inside a background is never allowed. When a row tints on hover, a control inside it answers with its own detail (the icon darkens from `--muted` to `--text`), never its own background or border.
- Selecting a row does not pin its options open. The overflow menu appears on hover, on a visible focus ring (`:has(:focus-visible)`, not `:focus-within`, because a mouse click leaves focus on the row), or while its menu is open.
- A state that is on (saved, pinned) is a filled icon, not an outline with a tick.
- Tabs are quiet text buttons (active = text colour on a subtle fill), never a grey segmented track with a shadowed pill. They do not take a row of their own when the header has room.
- Long option lists are grouped (`Select` `group`) with a small gap before each group title.

## Forms and controls

- The shape says what the control does: exactly two states is a switch; a tick means picking from a list or confirming once; more than two values is a dropdown.
- Required fields get the red asterisk; optional ones get nothing. The mark belongs on anything the form cannot be saved without, not only text inputs: a `Checkbox` that gates a save takes `required`, and a group of choices is marked once on its legend. Draw it in CSS so it never enters the accessible name, and skip it where a control is only conditionally required.
- Every form field gets a small leading icon (`FieldLabel` `icon`).
- Never repeat a heading as a label. A dialog tab or section whose heading already names its only field shows no field label: give the control `aria-label` (`Select`: `ariaLabel`) and put the note in the heading's `description`.
- Inside a fieldset or group whose legend says "Item 1", visible labels drop the repeated part ("Item name"); the full name stays for assistive technology (`aria-label`, or a `.visually-hidden` span inside a `Select` label).
- Name a titled section with `aria-labelledby` pointing at its heading, not an `aria-label` copy.
- One focus ring (`:focus-visible`), never a doubled border.
- Icon-only buttons need `aria-label`. Never disable a focused control that holds focus, since the page then gets Escape.

## States and feedback

- An outcome or state (success, failure, warning, waiting) always leads with a visible mark: an icon whose shape differs per outcome, in the status colour. Never text in one colour alone. Applies to result pages, inline errors, notices and status rows.
- Status text takes the colour of its dot (`--success`, `--error`, muted).
- A notice about the chat's or app's state (unfinished work, retry, limits) sits outside the message thread, by the prompt bar or on its own surface, never styled as something the assistant said.
- Notices sit on a plain surface, not a tinted wash with a dark button.
- A nav icon must not look like the product logo; use an icon that says where it goes.
- A wait is a `Skeleton` in the shape of what is coming. No spinners after the first frame.
- Missing evidence, unknown usage and partial failure stay visible; never paint them as success.
- Emails and similar personal values shown on screen are partly masked through `shared/pii.ts`.

## Motion

- Motion belongs to the orglet: flows move through the mascot's hop, glance and squash, never slide or fade like a slide deck.
- Use transform and opacity only. Nothing waits on an animation to be visible.
- Reduced motion cuts every animation to its end state.

## Text and language

- All user-facing text goes through `t('Vietnamese source text', [params])` from `renderer/i18n.ts`; Vietnamese is the key language.
- Add the English line to `apps/desktop/src/shared/locales/en.ts` and run `pnpm i18n:keys` (or `node scripts/i18n-keys.cjs --unused`). Tests fail on missing keys.
- Messages from the core are shown with `tMessage(...)`. Module-level label maps use `translated({...})`.
- Words on screen: workers are orglets and teams are channels.

## Alignment check

- Check alignment before handing anything over. A row holding controls of different heights (a 22px switch beside a 36px icon button, a mark beside a title) needs an explicit `align-items:center`; a flex row without one stretches children onto different centre lines.
- Measure, do not eyeball: after any UI change run `pnpm build`, then `pnpm test:alignment`. It checks centre lines, column text starts and icon slots, gaps, wraps and clips, and overflow at 1200x820 and 740x600 in light and dark.
- Fix every finding, or mark an intentional difference with `data-align-ignore="<kind>"` and a comment saying why.
- A screen the check does not visit yet is added to `scripts/alignment-check.mjs` in the same change that introduces it.
- When a state cannot be reached in a smoke and a stand-in is placed in the built app, the stand-in carries the component's real classes and attributes (`role`, `aria-*`) and sits in its real parent. Grep the stylesheet for attribute and child selectors on the parent first: a card checked without its `role=status` looked right, while in the app `.thread-content>[role=status]` right-aligned and muted it.
- Look for rows packed together without breathing room, labels that wrap where they should fit, icons or controls off the text's vertical centre, and uneven gaps. Screenshot at the real window size.
- `tests/integration/ui-kit-usage.test.ts` fails when raw `<button>`, `<select>`, checkbox inputs, `title=` attributes or hard-coded hex colours are added to a renderer file.
