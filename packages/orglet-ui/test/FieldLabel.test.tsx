import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { FieldLabel, Input } from '../src';

const FolderIcon = ({ size }: { size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }) => <svg data-testid="icon" width={size} height={size} aria-hidden="true" />;

describe('FieldLabel', () => {
  it('renders its text with a decorative leading icon', () => {
    render(<FieldLabel icon={FolderIcon}>Working folder</FieldLabel>);
    const label = screen.getByText('Working folder');
    expect(label.className).toBe('org-field-label');
    expect(screen.getByTestId('icon').getAttribute('aria-hidden')).toBe('true');
    expect(label.firstElementChild).toBe(screen.getByTestId('icon'));
  });

  it('draws the required asterisk outside the accessible name', () => {
    render(<label>
      <FieldLabel icon={FolderIcon} required>Working folder</FieldLabel>
      <Input />
    </label>);
    expect(screen.getByText('Working folder').className).toBe('org-field-label org-field-label-required');
    expect(screen.getByRole('textbox', { name: 'Working folder' })).toBeTruthy();
  });

  it('leaves the caller class last', () => {
    render(<FieldLabel icon={FolderIcon} required className="wide">Budget</FieldLabel>);
    expect(screen.getByText('Budget').className).toBe('org-field-label org-field-label-required wide');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<label>
      <FieldLabel icon={FolderIcon} required>Working folder</FieldLabel>
      <Input />
    </label>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
