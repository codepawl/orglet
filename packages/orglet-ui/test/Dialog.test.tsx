import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Confirmer, Drawer, confirmAction } from '../src';

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open library</button>
    <Drawer open={open} onClose={() => setOpen(false)} title="Library" description="Skills and notes you can reuse."
      actions={<button type="button">New skill</button>} closeLabel="Close panel" closeIcon={<span>×</span>}>
      <p>Body</p>
    </Drawer>
  </>;
}

describe('Drawer', () => {
  it('opens as a named, described dialog with its actions and a close button, and gives focus back when it closes', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    const opener = screen.getByRole('button', { name: 'Open library' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Library' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New skill' })).toBeTruthy();
    expect(document.querySelector('.org-dialog-overlay')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape, but first closes an open menu inside it', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    await user.click(screen.getByRole('button', { name: 'Open library' }));
    const menuButton = screen.getByRole('button', { name: 'New skill' });
    menuButton.setAttribute('aria-haspopup', 'menu');
    menuButton.setAttribute('aria-expanded', 'true');
    menuButton.focus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Library' })).toBeTruthy();
    menuButton.setAttribute('aria-expanded', 'false');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('has no accessibility violations when open', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    await user.click(screen.getByRole('button', { name: 'Open library' }));
    expect(await axe(document.body, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});

describe('confirmAction and Confirmer', () => {
  it('asks with the given words, resolves true on confirm and false on cancel', async () => {
    const user = userEvent.setup();
    render(<Confirmer confirmLabel="OK" cancelLabel="Cancel" />);
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => { answer = confirmAction({ title: 'Delete this chat?', description: 'It cannot be undone.', confirmLabel: 'Delete' }); });
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this chat?' });
    expect(dialog.textContent).toContain('It cannot be undone.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await expect(answer).resolves.toBe(true);
    act(() => { answer = confirmAction({ title: 'Leave without saving?' }); });
    await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await expect(answer).resolves.toBe(false);
  });

  it('answers an unanswered question with false when a new one is asked', async () => {
    render(<Confirmer confirmLabel="OK" cancelLabel="Cancel" />);
    let first: Promise<boolean> = Promise.resolve(true);
    act(() => { first = confirmAction({ title: 'First?' }); });
    act(() => { void confirmAction({ title: 'Second?' }); });
    await expect(first).resolves.toBe(false);
    expect(await screen.findByRole('alertdialog', { name: 'Second?' })).toBeTruthy();
  });
});
