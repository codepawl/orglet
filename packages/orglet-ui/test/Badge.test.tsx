import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Badge } from '../src';

describe('Badge', () => {
  it('shows its word, neutral by default, the caller class last', () => {
    render(<Badge className="wide">Draft</Badge>);
    const badge = screen.getByText('Draft');
    expect(badge.tagName).toBe('SPAN');
    expect(badge.className).toBe('org-badge org-badge-neutral wide');
  });

  it('carries its tone in a class', () => {
    render(<Badge tone="error">Failed</Badge>);
    expect(screen.getByText('Failed').className).toContain('org-badge-error');
  });

  it('shows a count exactly up to max and max plus above it', () => {
    render(<>
      <Badge count={7} />
      <Badge count={99} />
      <Badge count={100} />
      <Badge count={12} max={9} />
    </>);
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('99')).toBeTruthy();
    expect(screen.getByText('99+')).toBeTruthy();
    expect(screen.getByText('9+')).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<p>Build <Badge tone="success">Passed</Badge> <Badge tone="accent" count={3} /></p>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
