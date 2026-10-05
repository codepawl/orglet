import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Button, Tooltip } from '../src';

function renderTooltip(props: { shortcut?: string; className?: string } = {}) {
  return render(<Tooltip label="Delete" {...props}>
    <Button type="button" size="icon" aria-label="Delete chat">×</Button>
  </Tooltip>);
}

describe('Tooltip', () => {
  it('shows on keyboard focus, describes the trigger and leaves its name alone', async () => {
    const user = userEvent.setup();
    renderTooltip({ shortcut: 'Ctrl+K' });
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Delete chat' });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('Delete');
    expect(tooltip.textContent).toContain('Ctrl+K');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('shows after a short hover and hides when the pointer leaves', async () => {
    const user = userEvent.setup();
    renderTooltip();
    const trigger = screen.getByRole('button', { name: 'Delete chat' });
    await user.hover(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect((await screen.findByRole('tooltip')).textContent).toBe('Delete');
    await user.unhover(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
  });

  it('hides on Escape and when focus leaves', async () => {
    const user = userEvent.setup();
    render(<>
      <Tooltip label="Delete"><Button type="button">Delete</Button></Tooltip>
      <Button type="button">Next</Button>
    </>);
    await user.tab();
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.tab();
    await user.tab({ shift: true });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('keeps the child its own handlers, and stays out of a press', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Tooltip label="Save"><Button type="button" onClick={onClick}>Save</Button></Tooltip>);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('applies className last and has no accessibility violations', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderTooltip({ className: 'wide' });
    await user.tab();
    expect(screen.getByRole('tooltip').className).toBe('org-tooltip wide');
    expect(await axe(baseElement, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
