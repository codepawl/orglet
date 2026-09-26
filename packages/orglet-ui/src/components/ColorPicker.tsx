import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from './Button';
import './ColorPicker.css';

type Hsv = { hue: number; saturation: number; brightness: number };

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** Every string the picker shows or announces; the application passes them in its own language. */
export type ColorPickerLabels = {
  /** Names the whole panel. */
  panel: string;
  /** Names the saturation and brightness area. */
  area: string;
  /** What the area announces, from whole percentages. */
  areaValue: (saturation: number, brightness: number) => string;
  hue: string;
  hex: string;
  save: string;
  presets: string;
  saved: string;
  presetColor: (color: string) => string;
  savedColor: (color: string) => string;
  removeColor: (color: string) => string;
  removeTitle: string;
  done: string;
};

export type ColorPickerProps = {
  id?: string;
  value: string;
  onChange: (hex: string) => void;
  presets: readonly string[];
  saved: readonly string[];
  onSave: (hex: string) => void;
  onRemove: (hex: string) => void;
  onClose: () => void;
  labels: ColorPickerLabels;
};

/** A six-digit lowercase `#rrggbb`, or undefined when the text is not one. */
export function normalizeHex(text: string): string | undefined {
  const hex = `#${text.trim().replace(/^#/, '').toLowerCase()}`;
  return HEX_COLOR.test(hex) ? hex : undefined;
}

function hexToHsv(hex: string): Hsv {
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const brightest = Math.max(red, green, blue);
  const spread = brightest - Math.min(red, green, blue);
  let sector = 0;
  if (spread !== 0 && brightest === red) sector = ((green - blue) / spread) % 6;
  else if (spread !== 0 && brightest === green) sector = (blue - red) / spread + 2;
  else if (spread !== 0) sector = (red - green) / spread + 4;
  return {
    hue: (sector * 60 + 360) % 360,
    saturation: brightest === 0 ? 0 : spread / brightest,
    brightness: brightest,
  };
}

function hsvToHex({ hue, saturation, brightness }: Hsv): string {
  const channel = (offset: number) => {
    const position = (offset + hue / 60) % 6;
    const weight = Math.max(0, Math.min(position, 4 - position, 1));
    return Math.round((brightness - brightness * saturation * weight) * 255);
  };
  return `#${[5, 3, 1].map(offset => channel(offset).toString(16).padStart(2, '0')).join('')}`;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * A colour picker for a panel beside a row of swatches: a saturation and brightness area (pointer and arrow keys,
 * Shift for bigger steps), a hue slider and a hex field that change the colour live, preset swatches, and the person's
 * saved colours with a way to save the current one and remove any. It sets `data-popup-open`, so Escape closes the
 * panel and not the dialog around it.
 */
export function ColorPicker({ id, value, onChange, presets, saved, onSave, onRemove, onClose, labels }: ColorPickerProps) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [text, setText] = useState(value);
  const hex = hsvToHex(hsv);

  // Follow a colour chosen outside the picker (a preset in the row) without losing the hue a grey carries.
  useEffect(() => {
    if (value === hsvToHex(hsv)) return;
    setHsv(hexToHsv(value));
    setText(value);
  }, [value]);

  const apply = (next: Hsv) => {
    setHsv(next);
    const nextHex = hsvToHex(next);
    setText(nextHex);
    onChange(nextHex);
  };
  const pick = (color: string) => {
    setHsv(hexToHsv(color));
    setText(color);
    onChange(color);
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    apply({
      ...hsv,
      saturation: clamp((event.clientX - box.left) / box.width),
      brightness: 1 - clamp((event.clientY - box.top) / box.height),
    });
  };
  const moveWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, Partial<Hsv>> = {
      ArrowLeft: { saturation: clamp(hsv.saturation - step) },
      ArrowRight: { saturation: clamp(hsv.saturation + step) },
      ArrowUp: { brightness: clamp(hsv.brightness + step) },
      ArrowDown: { brightness: clamp(hsv.brightness - step) },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    apply({ ...hsv, ...move });
  };
  const closeOnEscape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onClose();
  };
  const typeHex = (typed: string) => {
    setText(typed);
    const next = normalizeHex(typed);
    if (next) pick(next);
  };

  const swatch = (color: string, label: string) => <button key={color} type="button" className="org-color-picker-swatch"
    style={{ '--org-swatch': color } as CSSProperties} aria-label={label} aria-pressed={color === value} title={color}
    onClick={() => pick(color)}>
    {color === value && <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>}
  </button>;

  return <div id={id} className="org-color-picker" role="group" aria-label={labels.panel} data-popup-open onKeyDown={closeOnEscape}>
    <div className="org-color-picker-editor">
      <div className="org-color-picker-area" style={{ '--org-hue': hsv.hue } as CSSProperties} role="slider" tabIndex={0}
        aria-label={labels.area} aria-valuetext={labels.areaValue(Math.round(hsv.saturation * 100), Math.round(hsv.brightness * 100))}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); fromPointer(event); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event); }}
        onKeyDown={moveWithKeys}>
        <span className="org-color-picker-thumb" style={{ left: `${hsv.saturation * 100}%`, top: `${(1 - hsv.brightness) * 100}%`, background: hex }} />
      </div>
      <input type="range" className="org-color-picker-hue" min={0} max={359} value={Math.round(hsv.hue)} aria-label={labels.hue}
        onChange={event => apply({ ...hsv, hue: Number(event.target.value) })} />
      <div className="org-color-picker-row">
        <span className="org-color-picker-preview" style={{ background: hex }} aria-hidden="true" />
        <input className="org-color-picker-hex" value={text} maxLength={7} spellCheck={false} aria-label={labels.hex}
          onChange={event => typeHex(event.target.value)} onBlur={() => setText(hex)} />
        <Button type="button" variant="outline" className="org-color-picker-action" onClick={() => onSave(hex)} disabled={saved.includes(hex)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
          {labels.save}
        </Button>
      </div>
    </div>
    <div className="org-color-picker-section">
      <span className="org-color-picker-title">{labels.presets}</span>
      <div className="org-color-picker-swatches">{presets.map(color => swatch(color, labels.presetColor(color)))}</div>
    </div>
    {saved.length > 0 && <div className="org-color-picker-section">
      <span className="org-color-picker-title">{labels.saved}</span>
      <div className="org-color-picker-swatches">{saved.map(color => <span key={color} className="org-color-picker-saved">
        {swatch(color, labels.savedColor(color))}
        <button type="button" className="org-color-picker-remove" aria-label={labels.removeColor(color)} title={labels.removeTitle} onClick={() => onRemove(color)}>
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </span>)}</div>
    </div>}
    <div className="org-color-picker-actions">
      <Button type="button" variant="ghost" className="org-color-picker-action" onClick={onClose}>{labels.done}</Button>
    </div>
  </div>;
}
