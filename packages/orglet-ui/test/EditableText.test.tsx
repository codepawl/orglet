import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { EditableText } from '../src';

/** Saves like the application does: the new name comes back as `value` once `save` has finished. */
function RenameableName({ save }: { save: (next: string) => void | Promise<void> }) {
  const [name, setName] = useState('Researcher');
  const commit = async (next: string) => {
    await save(next);
    setName(next);
  };
  return <EditableText value={name} onCommit={commit} label="Rename Researcher" maxLength={40} className="topbar-name" />;
}

function deferred() {
  let resolve = () => {};
  let reject = (_error: Error) => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('EditableText', () => {
  // COD-239: the chat header's name renames the orglet or crew in place. At rest it is a button that names what it
  // renames, so a screen reader hears "Rename Researcher" and a click or Enter starts editing.
  it('rests as a named button that shows the current value', () => {
    render(<EditableText value="Researcher" label="Rename Researcher" onCommit={() => undefined} className="topbar-name" />);
    const button = screen.getByRole('button', { name: 'Rename Researcher' });
    expect(button.textContent).toBe('Researcher');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('title')).toBe('Rename Researcher');
    expect(button.className).toBe('org-editable-text topbar-name');
  });

  it('can be turned off', async () => {
    const user = userEvent.setup();
    render(<EditableText value="Crew" label="Rename Crew" onCommit={() => undefined} disabled />);
    const button = screen.getByRole('button', { name: 'Rename Crew' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(button);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('opens with the text selected on a click, Enter or F2', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<RenameableName save={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Rename Researcher' }));
    const input = screen.getByRole('textbox', { name: 'Rename Researcher' }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Researcher'.length]);
    expect(input.className).toBe('org-editable-text org-editable-text-input topbar-name');
    expect(input.maxLength).toBe(40);
    unmount();

    for (const key of ['{Enter}', '{F2}']) {
      const view = render(<RenameableName save={() => undefined} />);
      await user.tab();
      await user.keyboard(key);
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Rename Researcher' }));
      view.unmount();
    }
  });

  it('keeps the change on Enter, once', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<RenameableName save={save} />);
    await user.click(screen.getByRole('button'));
    await user.keyboard('{Control>}a{/Control}Analyst{Enter}');
    expect(save.mock.calls).toEqual([['Analyst']]);
    expect(screen.getByRole('button').textContent).toBe('Analyst');
  });

  it('keeps the change when the field loses focus', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<><RenameableName save={save} /><button type="button">Elsewhere</button></>);
    await user.click(screen.getByRole('button', { name: 'Rename Researcher' }));
    await user.keyboard('  Analyst  ');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(save.mock.calls).toEqual([['Analyst']]);
  });

  it('puts the old value back on Escape', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<RenameableName save={save} />);
    await user.click(screen.getByRole('button'));
    await user.keyboard('Analyst{Escape}');
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('button').textContent).toBe('Researcher');
  });

  it('changes nothing for an empty or unchanged value', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<RenameableName save={save} />);
    await user.click(screen.getByRole('button'));
    await user.keyboard('{Control>}a{/Control}{Backspace}   {Enter}');
    await user.click(screen.getByRole('button'));
    await user.keyboard('{Enter}');
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('button').textContent).toBe('Researcher');
  });

  it('shows the new text while saving and the old one again when saving fails', async () => {
    const user = userEvent.setup();
    const saving = deferred();
    render(<RenameableName save={() => saving.promise} />);
    await user.click(screen.getByRole('button'));
    await user.keyboard('{Control>}a{/Control}Analyst{Enter}');
    expect(screen.getByRole('button').textContent).toBe('Analyst');
    saving.reject(new Error('disk full'));
    await vi.waitFor(() => expect(screen.getByRole('button').textContent).toBe('Researcher'));
  });

  it('has no accessibility violations at rest or while editing', async () => {
    const user = userEvent.setup();
    const { container } = render(<RenameableName save={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button'));
    expect(await axe(container)).toHaveNoViolations();
  });
});
