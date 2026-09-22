/**
 * The switch now lives in the kit (`packages/orglet-ui`), which is where a control that is not about Orglet
 * belongs. This file stays so the app keeps importing `./Switch`, and so the move can be undone in one place if
 * the kit turns out to be the wrong home for it.
 */
export { Switch, SwitchField } from '@codepawl/orglet-ui';
