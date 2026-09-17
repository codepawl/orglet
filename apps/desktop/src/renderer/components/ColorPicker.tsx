import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { t } from '../i18n';
import { Button } from './ui';

type Hsv = { h: number; s: number; v: number };
const HEX = /^#[0-9a-f]{6}$/;

export const normalizeHex = (text: string) => { const hex = `#${text.trim().replace(/^#/, '').toLowerCase()}`; return HEX.test(hex) ? hex : undefined; };

function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  const h = delta === 0 ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex({ h, s, v }: Hsv) {
  const channel = (n: number) => { const k = (n + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255); };
  return `#${[5, 3, 1].map(n => channel(n).toString(16).padStart(2, '0')).join('')}`;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Orglet colour panel, shown inline under a row of swatches (like Canva's "+" colour): a saturation/brightness area,
 * a hue slider and a hex field that change the colour live, preset swatches, and the user's saved colours with remove.
 * `data-popup-open` keeps Escape from closing the surrounding dialog; Escape closes the panel instead.
 */
export function ColorPicker({ id, value, onChange, presets, saved, onSave, onRemove, onClose }: {
  id?: string; value: string; onChange: (hex: string) => void; presets: readonly string[]; saved: readonly string[];
  onSave: (hex: string) => void; onRemove: (hex: string) => void; onClose: () => void;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [text, setText] = useState(value);
  const hex = hsvToHex(hsv);
  // Follow colours chosen outside the editor (a preset, a swatch in the row) without losing the hue of greys.
  useEffect(() => { if (value !== hsvToHex(hsv)) { setHsv(hexToHsv(value)); setText(value); } }, [value]);
  const apply = (next: Hsv) => { setHsv(next); const nextHex = hsvToHex(next); setText(nextHex); onChange(nextHex); };
  const pick = (next: string) => { setHsv(hexToHsv(next)); setText(next); onChange(next); };

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    apply({ ...hsv, s: clamp((event.clientX - box.left) / box.width), v: 1 - clamp((event.clientY - box.top) / box.height) });
  };
  const areaKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, Partial<Hsv>> = { ArrowLeft: { s: clamp(hsv.s - step) }, ArrowRight: { s: clamp(hsv.s + step) }, ArrowUp: { v: clamp(hsv.v + step) }, ArrowDown: { v: clamp(hsv.v - step) } };
    if (!moves[event.key]) return;
    event.preventDefault(); apply({ ...hsv, ...moves[event.key] });
  };
  const swatch = (color: string, label: string) => <button key={color} type="button" className="color-panel-swatch" style={{ '--swatch': color } as CSSProperties} aria-label={label} aria-pressed={color === value} title={color} onClick={() => pick(color)}>{color === value && <Check size={12} strokeWidth={3} aria-hidden="true" />}</button>;

  return <div id={id} className="color-panel" role="group" aria-label={t('Tạo màu')} data-popup-open onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <div className="color-panel-editor">
      <div className="color-area" style={{ '--hue': hsv.h } as CSSProperties} role="slider" tabIndex={0} aria-label={t('Độ đậm và độ sáng')} aria-valuetext={t('Độ đậm {0}%, độ sáng {1}%', [Math.round(hsv.s * 100), Math.round(hsv.v * 100)])}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); fromPointer(event); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event); }} onKeyDown={areaKeys}>
        <span className="color-area-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <input type="range" className="color-hue" min={0} max={359} value={Math.round(hsv.h)} aria-label={t('Sắc màu')} onChange={event => apply({ ...hsv, h: Number(event.target.value) })} />
      <div className="color-panel-row">
        <span className="color-panel-preview" style={{ background: hex }} aria-hidden="true" />
        <input className="color-hex" value={text} maxLength={7} spellCheck={false} aria-label={t('Mã màu hex')} onChange={event => { setText(event.target.value); const next = normalizeHex(event.target.value); if (next) pick(next); }} onBlur={() => setText(hex)} />
        <Button type="button" variant="outline" className="avatar-action" onClick={() => onSave(hex)} disabled={saved.includes(hex)}><Plus size={15} aria-hidden="true" />{t('Lưu màu')}</Button>
      </div>
    </div>
    <div className="color-panel-section">
      <span className="color-panel-title">{t('Màu có sẵn')}</span>
      <div className="color-panel-swatches">{presets.map(color => swatch(color, t('Màu {0}', [color])))}</div>
    </div>
    {saved.length > 0 && <div className="color-panel-section">
      <span className="color-panel-title">{t('Màu của bạn')}</span>
      <div className="color-panel-swatches">{saved.map(color => <span key={color} className="color-panel-saved">
        {swatch(color, t('Màu của bạn {0}', [color]))}
        <button type="button" className="color-panel-remove" aria-label={t('Xóa màu {0}', [color])} title={t('Xóa màu')} onClick={() => onRemove(color)}><X size={10} strokeWidth={3} aria-hidden="true" /></button>
      </span>)}</div>
    </div>}
    <div className="color-panel-actions"><Button type="button" variant="ghost" className="avatar-action" onClick={onClose}>{t('Xong')}</Button></div>
  </div>;
}
