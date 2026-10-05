import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Button, Card } from '../src';

describe('Card', () => {
  it('renders its title, description, actions and children, named by its title', () => {
    render(<Card title="Weekly report" description="Every Monday" actions={<Button type="button">Edit</Button>}>Body text</Card>);
    const card = screen.getByRole('region', { name: 'Weekly report' });
    expect(card.textContent).toContain('Every Monday');
    expect(card.textContent).toContain('Body text');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('draws no header when there is nothing for it, and applies className last', () => {
    const { container } = render(<Card className="wide">Only a body</Card>);
    expect(container.querySelector('.org-card-header')).toBeNull();
    expect(container.firstElementChild?.className).toBe('org-card wide');
  });

  it('is one button when interactive, driven from the keyboard', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Card interactive onClick={onClick} title="Open the report" description="Last run 2 hours ago" />);
    await user.tab();
    const card = screen.getByRole('button', { name: 'Open the report' });
    expect(document.activeElement).toBe(card);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<div>
      <Card title="Report" description="Weekly" actions={<Button type="button">Edit</Button>}>Body</Card>
      <Card interactive title="Open" onClick={() => undefined}>Body</Card>
    </div>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
