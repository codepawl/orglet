import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ColorPicker, normalizeHex, type ColorPickerLabels } from '../src';

const labels: ColorPickerLabels = {
  panel: 'Make a colour', area: 'Saturation and brightness', areaValue: (saturation, brightness) => `Saturation ${saturation}%, brightness ${brightness}%`,
  hue: 'Hue', hex: 'Hex code', save: 'Save colour', presets: 'Presets', saved: 'Your colours',
  presetColor: color => `Colour ${color}`, savedColor: color => `Your colour ${color}`, removeColor: color => `Remove colour ${color}`,
  removeTitle: 'Remove colour', done: 'Done',
};

function Harness({ onSave = () => undefined, onRemove = () => undefined, onClose = () => undefined, saved = [] as string[] }) {
  const [value, setValue] = useState('#4473d3');
  return <ColorPicker value={value} onChange={setValue} presets={['#4473d3', '#2e7d32']} saved={saved}
    onSave={onSave} onRemove={onRemove} onClose={onClose} labels={labels} />;
}

describe('normalizeHex', () => {
  it('accepts six digits with or without the hash, and nothing else', () => {
    expect(normalizeHex(' 4473D3 ')).toBe('#4473d3');
    expect(normalizeHex('#2E7D32')).toBe('#2e7d32');
    expect(normalizeHex('#fff')).toBeUndefined();
    expect(normalizeHex('blue')).toBeUndefined();
  });
});

describe('ColorPicker', () => {
  it('names its parts with the labels it is given and marks the current preset', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Make a colour' }).hasAttribute('data-popup-open')).toBe(true);
    expect(screen.getByRole('slider', { name: 'Saturation and brightness' }).getAttribute('aria-valuetext')).toMatch(/^Saturation \d+%, brightness \d+%$/);
    expect(screen.getByRole('slider', { name: 'Hue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Colour #4473d3' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Colour #2e7d32' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('picks a preset, follows a typed hex code, and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Colour #2e7d32' }));
    const hex = screen.getByRole('textbox', { name: 'Hex code' }) as HTMLInputElement;
    expect(hex.value).toBe('#2e7d32');
    await user.clear(hex);
    await user.type(hex, '#ff0000');
    expect(hex.value).toBe('#ff0000');
    const area = screen.getByRole('slider', { name: 'Saturation and brightness' });
    const before = area.getAttribute('aria-valuetext');
    area.focus();
    await user.keyboard('{ArrowLeft}');
    expect(area.getAttribute('aria-valuetext')).not.toBe(before);
    fireEvent.change(screen.getByRole('slider', { name: 'Hue' }), { target: { value: '120' } });
    expect(hex.value).not.toBe('#ff0000');
  });

  it('saves the current colour once, removes a saved one, and closes on Escape and Done', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onRemove = vi.fn();
    const onClose = vi.fn();
    render(<Harness onSave={onSave} onRemove={onRemove} onClose={onClose} saved={['#4473d3']} />);
    expect((screen.getByRole('button', { name: 'Save colour' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Colour #2e7d32' }));
    await user.click(screen.getByRole('button', { name: 'Save colour' }));
    expect(onSave).toHaveBeenCalledWith('#2e7d32');
    await user.click(screen.getByRole('button', { name: 'Remove colour #4473d3' }));
    expect(onRemove).toHaveBeenCalledWith('#4473d3');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness saved={['#2e7d32']} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
