import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { SearchField } from '../src';

describe('SearchField', () => {
  it('is a search field named by aria-label that passes its props to the input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchField aria-label="Search templates" placeholder="Name or tag" onChange={onChange} />);
    const field = screen.getByRole('searchbox', { name: 'Search templates' });
    expect(field.getAttribute('placeholder')).toBe('Name or tag');
    await user.type(field, 'Ada');
    expect((field as HTMLInputElement).value).toBe('Ada');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('draws the magnifier inside the box that holds the input', () => {
    render(<SearchField aria-label="Search" />);
    const box = screen.getByRole('searchbox').parentElement!;
    expect(box.className).toBe('org-search-field');
    expect(box.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes another role and type for a list it drives', () => {
    render(<SearchField type="text" role="combobox" aria-expanded={false} aria-controls="options" aria-label="Find a chat" />);
    expect(screen.getByRole('combobox', { name: 'Find a chat' }).getAttribute('type')).toBe('text');
  });

  it('applies the caller class last, on the box', () => {
    render(<SearchField aria-label="Search" className="page-search" />);
    expect(screen.getByRole('searchbox').parentElement!.className).toBe('org-search-field page-search');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<SearchField aria-label="Search templates" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
