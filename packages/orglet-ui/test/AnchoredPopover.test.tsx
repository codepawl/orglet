import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { AnchoredPopover } from '../src';

function PopoverHarness({ inDialog = false }: { inDialog?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const content = <>
    <button ref={anchor} type="button" onClick={() => setOpen(true)}>Pick a colour</button>
    <AnchoredPopover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Colour picker">
      <button type="button">Blue</button>
    </AnchoredPopover>
    <p>Outside</p>
  </>;
  return inDialog ? <div role="dialog" aria-label="Settings">{content}</div> : content;
}

describe('AnchoredPopover', () => {
  it('renders nothing while closed', () => {
    render(<PopoverHarness />);
    expect(screen.queryByRole('dialog', { name: 'Colour picker' })).toBeNull();
  });

  it('opens as a named dialog, marked for the dialog around it, and takes focus', async () => {
    const user = userEvent.setup();
    render(<PopoverHarness />);
    await user.click(screen.getByRole('button', { name: 'Pick a colour' }));
    const popover = screen.getByRole('dialog', { name: 'Colour picker' });
    expect(popover.hasAttribute('data-popup-open')).toBe(true);
    expect(popover.className).toContain('org-anchored-popover');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Blue' }));
  });

  it('closes on Escape and gives focus back to the anchor', async () => {
    const user = userEvent.setup();
    render(<PopoverHarness />);
    const anchor = screen.getByRole('button', { name: 'Pick a colour' });
    await user.click(anchor);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Colour picker' })).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it('closes on a pointer outside but not on one inside', async () => {
    const user = userEvent.setup();
    render(<PopoverHarness />);
    await user.click(screen.getByRole('button', { name: 'Pick a colour' }));
    await user.click(screen.getByRole('button', { name: 'Blue' }));
    expect(screen.getByRole('dialog', { name: 'Colour picker' })).toBeTruthy();
    await user.click(screen.getByText('Outside'));
    expect(screen.queryByRole('dialog', { name: 'Colour picker' })).toBeNull();
  });

  it('lives inside the open dialog it was opened from', async () => {
    const user = userEvent.setup();
    render(<PopoverHarness inDialog />);
    await user.click(screen.getByRole('button', { name: 'Pick a colour' }));
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    expect(settings.contains(screen.getByRole('dialog', { name: 'Colour picker' }))).toBe(true);
  });

  it('has no accessibility violations when open', async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<PopoverHarness />);
    await user.click(screen.getByRole('button', { name: 'Pick a colour' }));
    // The popover portals into the page, so the whole page is checked; the landmark rule is about the page, not the popover.
    expect(await axe(baseElement, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
