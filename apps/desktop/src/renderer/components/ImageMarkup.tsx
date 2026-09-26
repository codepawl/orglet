import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowUpRight, Circle, Crop, Highlighter, Pen, Redo2, Square, Type, Undo2 } from 'lucide-react';
import { Button, Input, ToolbarToggleGroup, type ToolbarToggleItem } from '@codepawl/orglet-ui';
import { t } from '../i18n';
import {
  cropFrom, exportFrame, extendStroke, isShape, isStroke, labelFont, paintMarkup, rectFrom, strokeWidth, textSize,
  type Mark, type Markup, type MarkupTool, type Point, type Size, type StrokeLevel,
} from '../markup';

/** One colour of the markup palette: the app's own tokens, read once when editing starts. */
export type MarkupColor = { id: string; label: string; value: string };

/** The tools, their names and the key that picks each. */
export function markupTools(): (ToolbarToggleItem & { value: MarkupTool })[] {
  return [
    { value: 'pen', label: t('Bút'), icon: <Pen size={16} />, shortcut: 'P' },
    { value: 'highlighter', label: t('Bút dạ quang'), icon: <Highlighter size={16} />, shortcut: 'H' },
    { value: 'arrow', label: t('Mũi tên'), icon: <ArrowUpRight size={16} />, shortcut: 'A' },
    { value: 'rectangle', label: t('Hình chữ nhật'), icon: <Square size={16} />, shortcut: 'R' },
    { value: 'ellipse', label: t('Hình elip'), icon: <Circle size={16} />, shortcut: 'O' },
    { value: 'text', label: t('Chữ'), icon: <Type size={16} />, shortcut: 'T' },
    { value: 'crop', label: t('Cắt ảnh'), icon: <Crop size={16} />, shortcut: 'C' },
  ];
}

/**
 * The palette: the person's accent and the theme's status colours, plus black and white for any picture. The status
 * colours are read from the light palette whatever the app is set to: the dark theme lightens them for a dark page,
 * and a pastel mark would be hard to see on the light screenshots and documents people mark up, and would bake the
 * theme into the saved picture. Each is resolved once, so a mark keeps its colour if the theme changes while editing.
 */
export function markupPalette(): MarkupColor[] {
  const probe = document.createElement('span');
  probe.className = 'theme-light';
  probe.hidden = true;
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const values = new Map(['--error', '--accent', '--warning', '--success'].map(name => [name, style.getPropertyValue(name).trim()]));
  probe.remove();
  const token = (name: string, fallback: string) => values.get(name) || fallback;
  return [
    { id: 'red', label: t('Đỏ'), value: token('--error', '#d93b3b') },
    { id: 'accent', label: t('Màu nhấn'), value: token('--accent', '#4473d3') },
    { id: 'amber', label: t('Vàng'), value: token('--warning', '#d99a1b') },
    { id: 'green', label: t('Xanh lá'), value: token('--success', '#2f9e5b') },
    { id: 'black', label: t('Đen'), value: '#111111' },
    { id: 'white', label: t('Trắng'), value: '#ffffff' },
  ];
}

const levels: { value: StrokeLevel; size: number }[] = [
  { value: 'thin', size: 4 },
  { value: 'medium', size: 7 },
  { value: 'thick', size: 11 },
];

/**
 * The drawing bar under the viewer's toolbar: the tool, the colour, the stroke width (also the text size), then undo
 * and redo. Each group is one Tab stop; the keys in the tooltips work anywhere in the viewer.
 */
export function MarkupToolbar({ tool, onTool, palette, color, onColor, level, onLevel, canUndo, canRedo, onUndo, onRedo }: {
  tool: MarkupTool; onTool: (tool: MarkupTool) => void;
  palette: MarkupColor[]; color: string; onColor: (id: string) => void;
  level: StrokeLevel; onLevel: (level: StrokeLevel) => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
}) {
  const colorItems: ToolbarToggleItem[] = palette.map(entry => ({
    value: entry.id, label: entry.label, icon: <span className="markup-swatch" style={{ background: entry.value }} aria-hidden="true" />,
  }));
  const levelLabels: Record<StrokeLevel, string> = { thin: t('Mảnh'), medium: t('Vừa'), thick: t('Đậm') };
  const levelItems: ToolbarToggleItem[] = levels.map((entry, index) => ({
    value: entry.value, label: levelLabels[entry.value], shortcut: String(index + 1),
    icon: <span className="markup-level" style={{ width: entry.size, height: entry.size }} aria-hidden="true" />,
  }));
  return <div role="toolbar" aria-label={t('Công cụ đánh dấu')} className="markup-toolbar">
    <ToolbarToggleGroup label={t('Công cụ')} items={markupTools()} value={tool} onValueChange={value => onTool(value as MarkupTool)} />
    <ToolbarToggleGroup label={t('Màu')} items={colorItems} value={color} onValueChange={onColor} className="markup-colors" />
    <ToolbarToggleGroup label={t('Độ dày nét')} items={levelItems} value={level} onValueChange={value => onLevel(value as StrokeLevel)} />
    <span className="markup-history">
      <Button type="button" size="icon" aria-label={t('Hoàn tác')} title={t('Hoàn tác (Ctrl+Z)')} aria-keyshortcuts="Control+Z" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></Button>
      <Button type="button" size="icon" aria-label={t('Làm lại')} title={t('Làm lại (Ctrl+Shift+Z)')} aria-keyshortcuts="Control+Shift+Z" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></Button>
    </span>
  </div>;
}

/** A label being typed where the person clicked, in picture pixels. */
type TextEntry = { at: Point; value: string };

/**
 * The picture with its marks, fitted to the space the viewer gives it, and the pointer drawing on it. Coordinates are
 * turned into picture pixels as they arrive, so zooming the window never moves a mark. A crop dims what it leaves out
 * rather than cutting it away, so it can still be undone or redrawn; the saved PNG holds only the crop.
 */
export function MarkupCanvas({ picture, size, markup, tool, color, width, fontSize, label, onCommit }: {
  picture: HTMLImageElement; size: Size; markup: Markup;
  tool: MarkupTool; color: string; width: number; fontSize: number; label: string;
  onCommit: (next: Markup) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [draft, setDraft] = useState<Mark>();
  const [cropDraft, setCropDraft] = useState<{ start: Point; end: Point }>();
  const [entry, setEntryState] = useState<TextEntry>();
  // The label being typed, also kept in a ref: a click elsewhere both blurs the field and starts a new label, and the
  // two must not keep the same label twice.
  const entryRef = useRef<TextEntry>(undefined);
  const entryField = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const setEntry = (next: TextEntry | undefined) => {
    // A label closed from the keyboard hands focus to the picture, not to the dialog itself, which would ring.
    const typing = document.activeElement === entryField.current;
    entryRef.current = next;
    setEntryState(next);
    if (!next && typing) frame.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const fit = () => {
      const available = { width: element.clientWidth, height: element.clientHeight };
      if (available.width <= 0 || available.height <= 0) return;
      setScale(Math.min(1, available.width / size.width, available.height / size.height));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [size.width, size.height]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(size.width * scale * ratio);
    element.height = Math.round(size.height * scale * ratio);
    context.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    const marks = draft ? [...markup.marks, draft] : markup.marks;
    paintMarkup(context, picture, size, { marks });
    const crop = cropDraft ? rectFrom(cropDraft.start, cropDraft.end) : markup.crop;
    if (crop) {
      context.save();
      context.fillStyle = 'rgba(0, 0, 0, 0.5)';
      context.beginPath();
      context.rect(0, 0, size.width, size.height);
      context.rect(crop.x, crop.y, crop.width, crop.height);
      context.fill('evenodd');
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.5 / scale;
      context.setLineDash([6 / scale, 4 / scale]);
      context.strokeRect(crop.x, crop.y, crop.width, crop.height);
      context.restore();
    }
  }, [picture, size, markup, draft, cropDraft, scale]);

  useEffect(() => { if (entry) entryField.current?.focus(); }, [entry?.at.x, entry?.at.y]);

  function pictureAt(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(size.width, Math.max(0, (event.clientX - bounds.left) / scale)),
      y: Math.min(size.height, Math.max(0, (event.clientY - bounds.top) / scale)),
    };
  }
  function commitEntry() {
    const typed = entryRef.current;
    if (!typed) return;
    const text = typed.value.trim();
    setEntry(undefined);
    if (text) onCommit({ ...markup, marks: [...markup.marks, { kind: 'text', at: typed.at, text, color, size: fontSize }] });
  }
  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    const point = pictureAt(event);
    if (tool === 'text') {
      // A click elsewhere while typing keeps what was typed, then starts a new label.
      commitEntry();
      event.preventDefault();
      setEntry({ at: point, value: '' });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'crop') { setCropDraft({ start: point, end: point }); return; }
    if (tool === 'pen' || tool === 'highlighter') { setDraft({ kind: tool, points: [point], color, width }); return; }
    setDraft({ kind: tool, from: point, to: point, color, width });
  }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!draft && !cropDraft) return;
    const point = pictureAt(event);
    if (cropDraft) { setCropDraft({ ...cropDraft, end: point }); return; }
    if (!draft) return;
    if (isStroke(draft)) setDraft(extendStroke(draft, point, 1.5 / scale));
    else if (isShape(draft)) setDraft({ ...draft, to: point });
  }
  function finish(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (cropDraft) {
      const crop = cropFrom(cropDraft.start, pictureAt(event), size);
      setCropDraft(undefined);
      if (crop || markup.crop) onCommit({ ...markup, crop });
      return;
    }
    if (!draft) return;
    setDraft(undefined);
    // A shape needs some extent; a click without a drag draws nothing. A pen dot is kept.
    if (isShape(draft)) {
      const extent = Math.hypot(draft.to.x - draft.from.x, draft.to.y - draft.from.y);
      if (extent < 3 / scale) return;
    }
    onCommit({ ...markup, marks: [...markup.marks, draft] });
  }
  const cursor = tool === 'text' ? 'text' : 'crosshair';
  return <div ref={stage} className="markup-stage">
    <div ref={frame} tabIndex={-1} className="markup-frame" style={{ width: size.width * scale, height: size.height * scale }}>
      <canvas ref={canvas} className="markup-canvas" role="img" aria-label={label} style={{ width: size.width * scale, height: size.height * scale, cursor }}
        onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { setDraft(undefined); setCropDraft(undefined); }} />
      {entry && <Input ref={entryField} className="markup-entry" data-popup-open="" aria-label={t('Chữ trên ảnh')} placeholder={t('Nhập chữ…')} value={entry.value}
        style={{ left: entry.at.x * scale, top: entry.at.y * scale, color, font: labelFont(fontSize * scale) }}
        onChange={event => setEntry({ ...entry, value: event.target.value })}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commitEntry(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEntry(undefined); }
        }}
        onBlur={() => { if (entryRef.current === entry) commitEntry(); }} />}
    </div>
  </div>;
}

/** Loads a picture's bytes as an image the canvas can draw, with its size in pixels. */
export function usePicture(bytes: Uint8Array, mimeType: string): { picture: HTMLImageElement; size: Size } | { failed: true } | undefined {
  const [loaded, setLoaded] = useState<{ picture: HTMLImageElement; size: Size } | { failed: true }>();
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
    const picture = new Image();
    let active = true;
    picture.src = url;
    picture.decode()
      .then(() => {
        if (!active) return;
        // An SVG without its own size is drawn at a common screen size.
        const width = picture.naturalWidth || 1200;
        const height = picture.naturalHeight || 900;
        setLoaded({ picture, size: { width, height } });
      })
      .catch(() => { if (active) setLoaded({ failed: true }); });
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [bytes, mimeType]);
  return loaded;
}

/** The marked-up picture as PNG bytes: the crop, or all of it, at the picture's own resolution. */
export async function markupPng(picture: HTMLImageElement, size: Size, markup: Markup): Promise<Uint8Array<ArrayBuffer>> {
  const frame = exportFrame(size, markup.crop);
  const output = document.createElement('canvas');
  output.width = frame.width;
  output.height = frame.height;
  const context = output.getContext('2d');
  if (!context) throw new Error(t('Không vẽ được ảnh để lưu.'));
  paintMarkup(context, picture, size, markup, frame);
  const blob = await new Promise<Blob | null>(resolve => output.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error(t('Không vẽ được ảnh để lưu.'));
  return new Uint8Array(await blob.arrayBuffer());
}

export { strokeWidth, textSize };
