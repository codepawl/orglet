import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { CommandBlock } from '../src';

const command = 'claude --settings C:\\Users\\ada\\harness-accounts\\work.json';

describe('CommandBlock', () => {
  it('shows the label, the command and a copy button named by copyLabel', () => {
    const { container } = render(<CommandBlock command={command} label="Sign in" copyLabel="Copy command" onCopy={() => undefined} />);
    expect(screen.getByText('Sign in').className).toBe('org-command-block-label');
    expect(container.querySelector('code')?.textContent).toBe(command);
    const copy = screen.getByRole('button', { name: 'Copy command' });
    expect(copy.getAttribute('title')).toBe('Copy command');
  });

  it('breaks the command only after a path separator or a space', () => {
    const { container } = render(<CommandBlock command={command} copyLabel="Copy command" onCopy={() => undefined} />);
    const pieces = Array.from(container.querySelectorAll('.org-command-block-piece')).map(piece => piece.textContent);
    expect(pieces).toEqual(['claude ', '--settings ', 'C:\\', 'Users\\', 'ada\\', 'harness-accounts\\', 'work.json']);
    expect(container.querySelectorAll('wbr')).toHaveLength(pieces.length - 1);
  });

  it('hands the command to onCopy on a click and from the keyboard', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(<CommandBlock command={command} copyLabel="Copy command" onCopy={onCopy} />);
    const copy = screen.getByRole('button', { name: 'Copy command' });
    await user.tab();
    expect(document.activeElement).toBe(copy);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    await user.click(copy);
    expect(onCopy.mock.calls).toEqual([[command], [command], [command]]);
  });

  it('puts the toolbar and the copy button on the card top bar', () => {
    const { container } = render(<CommandBlock
      command={command}
      copyLabel="Copy command"
      onCopy={() => undefined}
      toolbar={<button type="button">PowerShell</button>}
    />);
    const toolbar = container.querySelector('.org-command-block-toolbar') as HTMLElement;
    expect(toolbar.parentElement?.className).toBe('org-command-block-card org-command-block-with-toolbar');
    const [terminalPicker, copy] = Array.from(toolbar.children);
    expect(terminalPicker.textContent).toBe('PowerShell');
    expect(copy.getAttribute('aria-label')).toBe('Copy command');
  });

  it('applies the caller class last', () => {
    const { container } = render(<CommandBlock command={command} copyLabel="Copy command" onCopy={() => undefined} className="harness-login" />);
    expect((container.firstChild as HTMLElement).className).toBe('org-command-block harness-login');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<CommandBlock
      command={command}
      label="Sign in"
      copyLabel="Copy command"
      onCopy={() => undefined}
      toolbar={<button type="button">PowerShell</button>}
    />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
