import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Select, type SelectOption } from '../src';

const fruits: SelectOption[] = [
  { value: 'apple', label: 'Apple', detail: 'Red', group: 'Common' },
  { value: 'banana', label: 'Banana', group: 'Common' },
  { value: 'cherry', label: 'Cherry', disabled: true, group: 'Rare' },
  { value: 'damson', label: 'Damson', note: 'default', badge: 'New', group: 'Rare' },
];

function Harness({ onChange = () => {}, initial = 'apple' }: { onChange?: (value: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <>
    <span id="fruit-title">Fruit</span>
    <Select value={value} options={fruits} labelledBy="fruit-title" placeholder="Choose" onChange={next => { setValue(next); onChange(next); }} />
  </>;
}

describe('Select', () => {
  it('names the trigger by its title and shows the chosen label with its detail', () => {
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: 'Fruit' });
    expect(trigger.textContent).toBe('Apple · Red');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the placeholder while nothing is chosen', () => {
    render(<Harness initial="" />);
    expect(screen.getByRole('combobox', { name: 'Fruit' }).textContent).toBe('Choose');
  });

  it('opens a grouped list, skips a disabled choice with the arrows and chooses with Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Fruit' });
    await user.click(trigger);
    const list = screen.getByRole('listbox', { name: 'Fruit' });
    expect(list.textContent).toContain('Common');
    expect(list.textContent).toContain('Damson (default)');
    expect(screen.getByRole('option', { name: /Apple/ }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(trigger.getAttribute('aria-activedescendant')).toMatch(/option-3$/);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('damson');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape without letting the key reach a dialog around it', async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    render(<div onKeyDown={event => outer(event.key)}><Harness /></div>);
    await user.click(screen.getByRole('combobox', { name: 'Fruit' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(outer).not.toHaveBeenCalledWith('Escape');
  });

  it('jumps by typing, and chooses at once while closed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole('combobox', { name: 'Fruit' }).focus();
    await user.keyboard('b');
    expect(onChange).toHaveBeenCalledWith('banana');
  });

  it('never chooses a disabled option by pointer', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: 'Fruit' }));
    await user.click(screen.getByRole('option', { name: /Cherry/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks an invalid choice for assistive technology', () => {
    render(<Select value="" options={fruits} ariaLabel="Fruit" invalid flash={1} onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Fruit' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('has no accessibility violations, open or closed', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('combobox', { name: 'Fruit' }));
    expect(await axe(document.body, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
