import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Toaster, showToast } from '../src';

const icons = {
  success: <svg data-testid="success-icon" />,
  error: <svg data-testid="error-icon" />,
  info: <svg data-testid="info-icon" />,
};

describe('Toaster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Toasts live in a module-level store; letting every timer run empties it for the next test.
    act(() => { vi.runAllTimers(); });
    vi.useRealTimers();
  });

  it('announces a success politely with its icon and hides it after three seconds', () => {
    render(<Toaster icons={icons} />);
    act(() => { showToast('Saved'); });
    expect(screen.getByRole('status').textContent).toBe('Saved');
    expect(screen.getByTestId('success-icon')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('raises a fault as an alert that stays for six seconds', () => {
    render(<Toaster icons={icons} />);
    act(() => { showToast('Could not save', 'error'); });
    expect(screen.getByRole('alert').textContent).toBe('Could not save');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('replaces a repeated message and keeps at most three', () => {
    render(<Toaster icons={icons} />);
    act(() => {
      showToast('One');
      showToast('Two');
      showToast('One');
      showToast('Three');
      showToast('Four');
    });
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['One', 'Three', 'Four']);
  });

  it('runs its action once and takes the toast away', () => {
    const onSelect = vi.fn();
    render(<Toaster icons={icons} />);
    act(() => { showToast('Reply ready', 'info', { label: 'Open', onSelect }); });
    expect(screen.getByTestId('info-icon')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByText('Reply ready')).toBeNull();
  });

  it('shows the text through renderText, portaled to the page', () => {
    const { container } = render(<Toaster icons={icons} renderText={text => text.toUpperCase()} />);
    act(() => { showToast('Saved'); });
    expect(screen.getByRole('status').textContent).toBe('SAVED');
    expect(container.querySelector('.org-toaster')).toBeNull();
    expect(document.body.querySelector('.org-toaster')).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    render(<Toaster icons={icons} />);
    act(() => { showToast('Saved', 'success', { label: 'Undo', onSelect: () => {} }); });
    vi.useRealTimers();
    expect(await axe(document.body, { rules: { region: { enabled: false } } })).toHaveNoViolations();
    // Its timer went with the fake clock, so the action takes it away instead.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    vi.useFakeTimers();
  });
});
