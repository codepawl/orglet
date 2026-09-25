import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Switch, SwitchField } from '../src';

function ControlledSwitch({ initial = false }: { initial?: boolean }) {
  const [checked, setChecked] = useState(initial);
  return <Switch checked={checked} onChange={setChecked} label="Dark mode" />;
}

describe('Switch', () => {
  it('is a switch named by its label that reports its state', () => {
    render(<Switch checked={false} onChange={() => undefined} label="Dark mode" />);
    const control = screen.getByRole('switch', { name: 'Dark mode' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(control.getAttribute('type')).toBe('button');
  });

  it('can be named by the setting title it sits beside', () => {
    render(<>
      <span id="setting-title">Send reports</span>
      <Switch checked onChange={() => undefined} labelledBy="setting-title" />
    </>);
    expect(screen.getByRole('switch', { name: 'Send reports' }).getAttribute('aria-checked')).toBe('true');
  });

  it('toggles on Space and on Enter', async () => {
    const user = userEvent.setup();
    render(<ControlledSwitch />);
    const control = screen.getByRole('switch', { name: 'Dark mode' });
    await user.tab();
    expect(document.activeElement).toBe(control);
    await user.keyboard(' ');
    expect(control.getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{Enter}');
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('asks for the opposite state on a click and stays put while disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<Switch checked onChange={onChange} label="Dark mode" />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
    onChange.mockClear();
    rerender(<Switch checked onChange={onChange} label="Dark mode" disabled />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies the caller class last', () => {
    render(<Switch checked={false} onChange={() => undefined} label="Dark mode" className="settings-switch" />);
    expect(screen.getByRole('switch').className).toBe('org-switch settings-switch');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Switch checked onChange={() => undefined} label="Dark mode" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  // Keeps the axe checks honest: a switch nobody named has to fail them.
  it('fails the accessibility check without a name', async () => {
    const { container } = render(<Switch checked onChange={() => undefined} />);
    const results = await axe(container);
    expect(results.violations.map(violation => violation.id)).toContain('button-name');
  });
});

describe('SwitchField', () => {
  it('names the switch with its title and shows the description under it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SwitchField checked={false} onChange={onChange} description="Once a week">Send reports</SwitchField>);
    const control = screen.getByRole('switch', { name: 'Send reports' });
    expect(screen.getByText('Once a week').className).toBe('org-switch-field-description');
    await user.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('marks the whole row disabled and applies the caller class last', () => {
    const { container } = render(<SwitchField checked onChange={() => undefined} disabled className="worker-auto-apply">Send reports</SwitchField>);
    expect((container.firstChild as HTMLElement).className).toBe('org-switch-field org-switch-field-disabled worker-auto-apply');
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<SwitchField checked onChange={() => undefined} description="Once a week">Send reports</SwitchField>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
