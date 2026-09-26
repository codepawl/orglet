import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { StatusMark, type StatusMarkTone, type StatusMarkVariant } from '../src';

describe('StatusMark', () => {
  it('is a status named by its label, with its state in its classes', () => {
    render(<StatusMark variant="busy" tone="working" label="Working" />);
    const mark = screen.getByRole('status', { name: 'Working' });
    expect(mark.className).toBe('org-status-mark org-status-mark-busy org-status-mark-working');
    expect(mark.getAttribute('title')).toBe('Working');
  });

  it('draws a different glyph for each state, so colour is never the only difference', () => {
    const drawn = (variant: StatusMarkVariant, tone: StatusMarkTone) => {
      const { container, unmount } = render(<StatusMark variant={variant} tone={tone} label={`${variant} ${tone}`} />);
      const glyph = container.querySelector('svg')!.innerHTML;
      unmount();
      return glyph;
    };
    const glyphs = [drawn('empty', 'muted'), drawn('dashed', 'muted'), drawn('paused', 'muted'), drawn('busy', 'working'), drawn('filled', 'success'), drawn('filled', 'error')];
    expect(new Set(glyphs).size).toBe(glyphs.length);
    expect(drawn('dashed', 'error')).toBe(drawn('filled', 'error'));
  });

  it('draws a pause as two bars on a tint, never as a ring like idle (COD-287)', () => {
    const { container } = render(<StatusMark variant="paused" label="Paused" />);
    const mark = container.querySelector('.org-status-mark')!;
    expect(mark.className).toContain('org-status-mark-paused');
    expect(mark.querySelector('circle')).toBeNull();
    expect(mark.querySelector('path')!.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+v[\d.]+M[\d.]+ [\d.]+v[\d.]+$/);
  });

  it('stays out of the accessible name when decorative, and applies the caller class last', () => {
    const { container } = render(<button type="button">Researcher <StatusMark variant="filled" tone="success" label="Unread" decorative className="row-mark" /></button>);
    expect(screen.getByRole('button').textContent).toBe('Researcher ');
    const mark = container.querySelector('.org-status-mark')!;
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.className.endsWith(' row-mark')).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<StatusMark variant="dashed" tone="error" label="Needs you" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
