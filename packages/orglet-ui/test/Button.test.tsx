import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Button } from '../src';

describe('Button', () => {
  it('is quiet by default and carries its variant and size in its classes, the caller class last', () => {
    render(<>
      <Button>Cancel</Button>
      <Button variant="primary">Save</Button>
      <Button variant="outline" className="wide">Export</Button>
      <Button size="icon" aria-label="Close panel">×</Button>
    </>);
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toBe('org-button org-button-ghost');
    expect(screen.getByRole('button', { name: 'Save' }).className).toBe('org-button org-button-primary');
    expect(screen.getByRole('button', { name: 'Export' }).className).toBe('org-button org-button-outline wide');
    expect(screen.getByRole('button', { name: 'Close panel' }).className).toBe('org-button org-button-ghost org-button-icon');
  });

  it('passes every button prop and the ref through, and leaves type to the caller', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(<form onSubmit={event => event.preventDefault()}>
      <Button ref={ref} onClick={onClick} title="Run now" data-kind="run">Run</Button>
    </form>);
    const button = screen.getByRole('button', { name: 'Run' });
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(ref.current).toBe(button);
    expect(button.getAttribute('data-kind')).toBe('run');
    expect(button.hasAttribute('type')).toBe(false);
  });

  it('does nothing while disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Send</Button>);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<div><Button variant="primary">Save</Button><Button size="icon" aria-label="Settings">⚙</Button></div>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
