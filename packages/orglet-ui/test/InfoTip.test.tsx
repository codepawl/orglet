import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { InfoTip } from '../src';

const rows = [
  { label: 'Run', value: '8f2c…', mono: true, onCopy: vi.fn() },
  { label: 'Folder', value: 'C:\work\shop' },
];

function renderTip() {
  return render(<InfoTip label="Technical detail" rows={rows} icon={<span>i</span>} copyLabel={rowLabel => `Copy ${rowLabel}`} />);
}

describe('InfoTip', () => {
  it('opens on keyboard focus with every row, and describes the trigger while open', async () => {
    const user = userEvent.setup();
    renderTip();
    const trigger = screen.getByRole('button', { name: 'Technical detail' });
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    const panel = screen.getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(panel.id);
    expect(panel.textContent).toContain('Folder');
    expect(panel.querySelector('.org-info-tip-mono')?.textContent).toContain('8f2c');
  });

  it('pins open on click so the copy button can be reached, and closes on Escape', async () => {
    const user = userEvent.setup();
    renderTip();
    await user.click(screen.getByRole('button', { name: 'Technical detail' }));
    await user.click(screen.getByRole('button', { name: 'Copy Run' }));
    expect(rows[0].onCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('has no copy button for a row without onCopy, and no accessibility violations', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderTip();
    await user.click(screen.getByRole('button', { name: 'Technical detail' }));
    expect(screen.queryByRole('button', { name: 'Copy Folder' })).toBeNull();
    expect(await axe(baseElement, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
