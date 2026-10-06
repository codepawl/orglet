import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { RadioGroup, type RadioOption } from '../src';

const options: RadioOption[] = [
  { value: 'daily', label: 'Every day', description: 'At 08:00' },
  { value: 'weekly', label: 'Every week' },
  { value: 'never', label: 'Never', disabled: true },
];

function Example({ onChange, className, required }: { onChange?: (value: string) => void; className?: string; required?: boolean }) {
  const [value, setValue] = useState('daily');
  return <RadioGroup label="Send the report" name="schedule" options={options} value={value} required={required} className={className}
    onChange={next => {
      setValue(next);
      onChange?.(next);
    }} />;
}

describe('RadioGroup', () => {
  it('is a group named by its legend, with one radio per option', () => {
    render(<Example />);
    expect(screen.getByRole('radiogroup', { name: 'Send the report' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect((screen.getByRole('radio', { name: /Every day/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Never' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('gives the picked value to onChange on click and from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Example onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Every week' }));
    expect(onChange).toHaveBeenLastCalledWith('weekly');
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith('daily');
  });

  it('keeps the required asterisk out of the name and applies className last', () => {
    render(<Example required className="wide" />);
    const group = screen.getByRole('radiogroup', { name: 'Send the report' });
    expect(group.getAttribute('aria-required')).toBe('true');
    expect(group.className).toBe('org-radio-group wide');
    expect(group.querySelector('legend')?.className).toContain('org-radio-group-required');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Example required />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
