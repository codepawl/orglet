import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { RowMenu, type RowMenuIcon } from '../src';

const Dot: RowMenuIcon = ({ size }) => <svg width={size} height={size} aria-hidden="true" />;

function renderMenu(overrides: Partial<Parameters<typeof RowMenu>[0]> = {}) {
  const rename = vi.fn();
  const remove = vi.fn();
  render(<RowMenu label="Options for Dev" icon={Dot} cancelLabel="No" items={[
    { label: 'Rename', icon: Dot, onSelect: rename, shortcut: 'F2' },
    { label: 'Delete', icon: Dot, onSelect: remove, danger: true, confirm: { question: 'Delete this orglet?', label: 'Delete' } },
  ]} {...overrides} />);
  return { rename, remove };
}

describe('RowMenu', () => {
  it('opens a named menu from its trigger, focuses the first item, and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Options for Dev' });
    expect(trigger.getAttribute('aria-keyshortcuts')).toBe('F2');
    await user.click(trigger);
    expect(screen.getByRole('menu', { name: 'Options for Dev' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Rename/ }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
  });

  it('runs a plain item at once and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const { rename } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'Options for Dev' }));
    await user.click(screen.getByRole('menuitem', { name: /Rename/ }));
    expect(rename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Options for Dev' }));
  });

  it('asks before a destructive item, and the way back runs nothing', async () => {
    const user = userEvent.setup();
    const { remove } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'Options for Dev' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByText('Delete this orglet?')).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: 'No' }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('opens a lone asking item straight on its question, and closes on Escape', async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    render(<RowMenu label="Delete chat" icon={Dot} cancelLabel="No" asksOnOpen
      items={[{ label: 'Delete', icon: Dot, onSelect: remove, confirm: { question: 'Delete this chat?', label: 'Delete' } }]} />);
    await user.click(screen.getByRole('button', { name: 'Delete chat' }));
    expect(screen.getByText('Delete this chat?')).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('has no accessibility violations when open', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Options for Dev' }));
    expect(await axe(document.body, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});

describe('RowMenu with more items', () => {
  it('moves one item per arrow press, wrapping at the ends', async () => {
    const user = userEvent.setup();
    render(<RowMenu label="Options" icon={Dot} cancelLabel="No" items={['Edit', 'Rename', 'Archive', 'Delete'].map(label => ({ label, icon: Dot, onSelect: () => undefined }))} />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Archive' }));
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
  });
});
