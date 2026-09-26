import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { MoneyInput } from '../src';

function Harness({ invalid = false }: { invalid?: boolean }) {
  const [value, setValue] = useState('');
  return <label>Monthly limit<MoneyInput value={value} onChange={setValue} symbol="$" code="USD" invalid={invalid} flash={invalid ? 2 : undefined} /></label>;
}

describe('MoneyInput', () => {
  it('is a decimal field named by its label, with the symbol and code hidden from its name', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const field = screen.getByRole('textbox', { name: 'Monthly limit' }) as HTMLInputElement;
    expect(field.getAttribute('inputmode')).toBe('decimal');
    await user.type(field, '12.50');
    expect(field.value).toBe('12.50');
    expect(container.querySelector('.org-money-input-currency')?.textContent).toBe('USD');
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it('marks an invalid amount and carries the flash counter', () => {
    const { container } = render(<Harness invalid />);
    const wrapper = container.querySelector('.org-money-input')!;
    expect(wrapper.className).toBe('org-money-input org-money-input-invalid');
    expect(wrapper.getAttribute('data-flash')).toBe('2');
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
