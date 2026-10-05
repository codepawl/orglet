import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Progress } from '../src';

describe('Progress', () => {
  it('is a progress bar named by its label, with its value and range', () => {
    render(<Progress label="Files copied" value={3} max={12} valueText="3 of 12" />);
    const bar = screen.getByRole('progressbar', { name: 'Files copied' });
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('12');
    expect(bar.getAttribute('aria-valuetext')).toBe('3 of 12');
    expect(screen.getByText('3 of 12')).toBeTruthy();
  });

  it('is out of 100 by default and fills to that share', () => {
    const { container } = render(<Progress label="Upload" value={40} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('100');
    expect((container.querySelector('.org-progress-fill') as HTMLElement).style.width).toBe('40%');
  });

  it('holds a value outside the range to it', () => {
    render(<><Progress label="Over" value={180} /><Progress label="Under" value={-5} /></>);
    expect(screen.getByRole('progressbar', { name: 'Over' }).getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByRole('progressbar', { name: 'Under' }).getAttribute('aria-valuenow')).toBe('0');
  });

  it('applies className last and has no accessibility violations', async () => {
    const { container } = render(<Progress label="Upload" value={40} valueText="40%" className="wide" />);
    expect(container.firstElementChild?.className).toBe('org-progress wide');
    expect(await axe(container)).toHaveNoViolations();
  });
});
