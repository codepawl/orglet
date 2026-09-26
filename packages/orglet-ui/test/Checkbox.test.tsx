import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Checkbox } from '../src';

function ControlledCheckbox() {
  const [checked, setChecked] = useState(false);
  return <Checkbox checked={checked} onChange={event => setChecked(event.target.checked)} description="Only files you attach">Read sources</Checkbox>;
}

describe('Checkbox', () => {
  it('is a real checkbox named by its label, with the description beside it', () => {
    render(<Checkbox defaultChecked description="Only files you attach">Read sources</Checkbox>);
    const control = screen.getByRole('checkbox', { name: /Read sources/ });
    expect((control as HTMLInputElement).checked).toBe(true);
    expect(control.getAttribute('type')).toBe('checkbox');
    expect(screen.getByText('Only files you attach').className).toBe('org-checkbox-description');
  });

  it('toggles on a click on its label and on Space', async () => {
    const user = userEvent.setup();
    render(<ControlledCheckbox />);
    const control = screen.getByRole('checkbox') as HTMLInputElement;
    await user.click(screen.getByText('Read sources'));
    expect(control.checked).toBe(true);
    await user.keyboard(' ');
    expect(control.checked).toBe(false);
  });

  it('marks a required choice for assistive technology without the browser bubble', () => {
    render(<Checkbox required>Accept the terms</Checkbox>);
    const control = screen.getByRole('checkbox', { name: 'Accept the terms' });
    expect(control.getAttribute('aria-required')).toBe('true');
    expect(control.hasAttribute('required')).toBe(false);
    expect(screen.getByText('Accept the terms').className).toContain('org-checkbox-required');
  });

  it('shows a disabled choice as disabled and applies the caller class last', () => {
    const { container } = render(<Checkbox disabled className="picker-row">Archived</Checkbox>);
    const label = container.querySelector('label')!;
    expect(label.className).toBe('org-checkbox org-checkbox-disabled picker-row');
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Checkbox description="Shown under the label">Send a copy</Checkbox>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
