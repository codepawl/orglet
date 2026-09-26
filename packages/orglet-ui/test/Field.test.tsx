import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Input, Textarea } from '../src';

describe('Input', () => {
  it('is a text field named by its label that passes its props through', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<label>Name<Input placeholder="Researcher" maxLength={40} onChange={onChange} /></label>);
    const field = screen.getByRole('textbox', { name: 'Name' });
    expect(field.getAttribute('placeholder')).toBe('Researcher');
    expect(field.getAttribute('maxlength')).toBe('40');
    await user.type(field, 'Ada');
    expect((field as HTMLInputElement).value).toBe('Ada');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('marks a failed field and replays the flash for each failed submit', () => {
    const { rerender } = render(<Input aria-label="Name" invalid flash={1} />);
    const field = screen.getByRole('textbox', { name: 'Name' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('data-flash')).toBe('1');
    rerender(<Input aria-label="Name" invalid flash={2} />);
    expect(field.getAttribute('data-flash')).toBe('2');
    rerender(<Input aria-label="Name" flash={3} />);
    expect(field.hasAttribute('aria-invalid')).toBe(false);
    expect(field.hasAttribute('data-flash')).toBe(false);
  });

  it('applies the caller class last', () => {
    render(<Input aria-label="Name" className="money-input" />);
    expect(screen.getByRole('textbox').className).toBe('org-input money-input');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<label>Name<Input invalid flash={1} /></label>);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Textarea', () => {
  it('is a multi-line field named by its label', async () => {
    const user = userEvent.setup();
    render(<label>Instructions<Textarea rows={4} /></label>);
    const field = screen.getByRole('textbox', { name: 'Instructions' });
    expect(field.tagName).toBe('TEXTAREA');
    await user.type(field, 'First line{Enter}Second line');
    expect((field as HTMLTextAreaElement).value).toBe('First line\nSecond line');
  });

  it('marks a failed field and applies the caller class last', () => {
    render(<Textarea aria-label="Instructions" invalid className="editor-body" />);
    const field = screen.getByRole('textbox', { name: 'Instructions' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.className).toBe('org-input org-textarea editor-body');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<label>Instructions<Textarea /></label>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
