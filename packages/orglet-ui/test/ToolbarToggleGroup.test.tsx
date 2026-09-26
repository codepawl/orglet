import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { ToolbarToggleGroup, type ToolbarToggleItem } from '../src';

const tools: ToolbarToggleItem[] = [
  { value: 'pen', label: 'Pen', icon: <svg aria-hidden="true" />, shortcut: 'P' },
  { value: 'arrow', label: 'Arrow', icon: <svg aria-hidden="true" />, shortcut: 'A' },
  { value: 'text', label: 'Text', icon: <svg aria-hidden="true" /> },
];

function Harness({ className }: { className?: string }) {
  const [tool, setTool] = useState('pen');
  return <>
    <button type="button">Before</button>
    <ToolbarToggleGroup label="Tool" items={tools} value={tool} onValueChange={setTool} className={className} />
    <output>{tool}</output>
  </>;
}

describe('ToolbarToggleGroup', () => {
  it('is a named radio group with one picked item, a tooltip with the shortcut and the shortcut announced', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Tool' });
    expect(group).toBeTruthy();
    const pen = screen.getByRole('radio', { name: 'Pen' });
    expect(pen.getAttribute('aria-checked')).toBe('true');
    expect(pen.getAttribute('title')).toBe('Pen (P)');
    expect(pen.getAttribute('aria-keyshortcuts')).toBe('P');
    expect(screen.getByRole('radio', { name: 'Text' }).getAttribute('title')).toBe('Text');
    expect(screen.getByRole('radio', { name: 'Arrow' }).getAttribute('aria-checked')).toBe('false');
  });

  it('is one Tab stop, and the arrow keys, Home and End move the choice and the focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Pen' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Arrow' }));
    expect(screen.getByRole('status').textContent).toBe('arrow');
    await user.keyboard('{End}');
    expect(screen.getByRole('status').textContent).toBe('text');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('status').textContent).toBe('pen');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('status').textContent).toBe('text');
    await user.keyboard('{Home}');
    expect(screen.getByRole('status').textContent).toBe('pen');
    await user.tab();
    expect(document.activeElement?.getAttribute('role')).not.toBe('radio');
  });

  it('picks on click, keeps the caller class last and has no accessibility violations', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness className="drawing-tools" />);
    await user.click(screen.getByRole('radio', { name: 'Text' }));
    expect(screen.getByRole('radio', { name: 'Text' }).getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('.org-toolbar-group')?.className).toBe('org-toolbar-group drawing-tools');
    expect(await axe(container)).toHaveNoViolations();
  });
});
