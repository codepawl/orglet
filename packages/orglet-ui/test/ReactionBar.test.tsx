import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ReactionBadges, ReactionBar } from '../src';

const options = [
  { name: 'thanks', emoji: '🙏', meaning: 'Thanks' },
  { name: 'funny', emoji: '😂', meaning: 'Funny' },
] as const;

describe('ReactionBar', () => {
  it('opens its row from a named trigger, shows the picked face pressed, and closes after a pick', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ReactionBar options={options} picked="funny" onPick={onPick} label="React" icon={<span>☺</span>} />);
    const trigger = screen.getByRole('button', { name: 'React' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    expect(screen.getByRole('group', { name: 'React' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Funny' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Thanks' }));
    expect(onPick).toHaveBeenCalledWith('thanks');
    expect(screen.queryByRole('group', { name: 'React' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape and on a pointer outside', async () => {
    const user = userEvent.setup();
    render(<><ReactionBar options={options} onPick={() => undefined} label="React" icon="☺" /><p>Elsewhere</p></>);
    await user.click(screen.getByRole('button', { name: 'React' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'React' }));
    await user.click(screen.getByText('Elsewhere'));
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('has no accessibility violations when open', async () => {
    const user = userEvent.setup();
    const { container } = render(<ReactionBar options={options} onPick={() => undefined} label="React" icon="☺" />);
    await user.click(screen.getByRole('button', { name: 'React' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ReactionBadges', () => {
  it('draws nothing without badges, a count only above one, and passes the badge name back', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const { container, rerender } = render(<ReactionBadges badges={[]} align="end" onPick={onPick} />);
    expect(container.innerHTML).toBe('');
    rerender(<ReactionBadges align="start" onPick={onPick} badges={[
      { name: 'thanks', emoji: '🙏', count: 1, mine: true, label: 'You reacted Thanks' },
      { name: 'funny', emoji: '😂', count: 2, mine: false, label: 'Minh and Lan reacted Funny' },
    ]} />);
    expect(container.firstElementChild!.className).toBe('org-reaction-badges org-reaction-badges-start');
    expect(screen.getByRole('button', { name: 'You reacted Thanks' }).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('.org-reaction-badge-count')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Minh and Lan reacted Funny' }));
    expect(onPick).toHaveBeenCalledWith('funny');
  });
});
