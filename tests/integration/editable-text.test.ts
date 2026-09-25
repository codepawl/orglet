import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { EditableText } from '../../packages/orglet-ui/src/components/EditableText';

// COD-239: the chat header's name renames the orglet or crew in place. At rest it is a button that names what it
// renames, so a screen reader hears "Rename Researcher" and a click or Enter starts editing.

it('rests as a named button that shows the current value', () => {
  const markup = renderToStaticMarkup(createElement(EditableText, { value: 'Researcher', label: 'Rename Researcher', onCommit: () => undefined, className: 'topbar-name' }));
  expect(markup).toContain('<button');
  expect(markup).toContain('type="button"');
  expect(markup).toContain('aria-label="Rename Researcher"');
  expect(markup).toContain('class="org-editable-text topbar-name"');
  expect(markup).toContain('>Researcher</button>');
});

it('can be turned off', () => {
  const markup = renderToStaticMarkup(createElement(EditableText, { value: 'Crew', label: 'Rename Crew', onCommit: () => undefined, disabled: true }));
  expect(markup).toContain('disabled=""');
});
