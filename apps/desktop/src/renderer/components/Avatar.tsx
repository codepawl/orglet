import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Briefcase, ChartColumn, Check, ChevronDown, Code, Headset, PenLine, Plus, Shuffle, ShieldCheck, SlidersHorizontal, Smile, Sparkles } from 'lucide-react';
import { t } from '../i18n';
import { Mascot, isMascot, mascotIds, mascots, type MascotGlyph, type MascotId } from './mascots';
import { autoMascot, avatarPalette, mascotCategoryIds, mascotCategoryLabels, mascotColors, seedHash, suggestedColors, suggestedMascots, type MascotCategory, type MascotHints } from './mascotSuggest';
import { Orglet3D, type FaceMotion } from './Orglet3D';
import { ColorPicker } from './ColorPicker';
import { Select } from './Select';
import { Button } from './ui';
import type { Worker } from '../../shared/contracts';

export { avatarPalette };
export type { FaceMotion };
/** `xxs` is the 16px read receipt, `xxl` the greeting of an empty chat; the others are the sizes the stylesheet names. */
export type AvatarSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
export const avatarColor = (seed: string, color?: string) => color ?? avatarPalette[seedHash(seed) % avatarPalette.length];
// Presets in the colour panel: the identity palette plus deeper office tones.
const colorPresets = [...avatarPalette, '#2f4b7c', '#3d4451', '#2e7d5b', '#9b3d5a', '#b8862b', '#3b9ad9', '#8a7bd8', '#8d6e63'];

/**
 * Orglet avatar for a worker, team or other named entity: a mascot, an emoji or the first letter in the entity's
 * colour, with an optional small badge (for example the provider mark) in the corner. With `defaultMascot`, an entity
 * that picked nothing gets the mascot suggested by its name and `hint` (its description), in that mascot's colour, so
 * every worker has a fitting face without choosing anything.
 * Decorative: the name is always shown next to it, so it is hidden from assistive technology.
 * `seed` should be a stable id so renaming does not change an automatic choice among equals.
 */
export function Avatar({ name, seed, emoji, mascot, defaultMascot, hint, color, badge, size = 'md', shape = 'rounded', alive, motion }: {
  name: string; seed?: string; emoji?: string; mascot?: string; letter?: boolean; defaultMascot?: boolean; hint?: string; color?: string; badge?: ReactNode; size?: AvatarSize; shape?: 'rounded' | 'circle';
  /** Blinks now and then. Only for the handful of faces in the chat you are reading, never a whole list at once. */
  alive?: boolean;
  /** How a large (`lg` and up) face behaves; see `Orglet3D`. The small sizes ignore it: their motion is the stylesheet's. */
  motion?: FaceMotion;
}) {
  const letter = [...name.trim()][0]?.toLocaleUpperCase() ?? '?';
  // Workers only use mascots (user decision 2026-09-17), so emoji or letter values saved earlier are ignored there.
  const face = defaultMascot ? (isMascot(mascot) ? mascot : autoMascot(mascotIds, seed ?? name, { name, description: hint })) : emoji ? 'emoji' : isMascot(mascot) ? mascot : undefined;
  const ink = color ?? (defaultMascot && face && face !== 'emoji' ? mascotColors[face] : avatarColor(seed ?? name));
  // Each face waits its own share of the idle cycle before blinking, so two of them never blink together, and
  // looks up towards its own side, so two faces on one screen never mirror each other.
  const hash = seedHash(seed ?? name);
  const idleDelay = `-${hash % IDLE_SECONDS}s`;
  const idleSide = hash % 2 === 0 ? 1 : -1;
  return <span className={`avatar ${size} ${shape} ${face === 'emoji' ? 'emoji' : face ? 'has-mascot' : ''}${alive ? ' alive' : ''}`}
    style={{ '--avatar-color': ink, '--idle-delay': idleDelay, '--idle-side': idleSide } as CSSProperties} aria-hidden="true">
    <span className="avatar-face">{face === 'emoji' ? emoji : face ? avatarRenderer(size) === 'solid' ? <Orglet3D id={face} seed={hash} size={solidSizes[size]} color={ink} motion={motion} /> : <Mascot id={face} glyph={mascotGlyph(size)} /> : letter}</span>
    {badge && <span className="avatar-badge">{badge}</span>}
  </span>;
}

/** One idle cycle (`--motion-idle` in styles.css: a blink, and on a prominent face a look-up); the delay is spread across it. */
const IDLE_SECONDS = 7;

/**
 * Which drawing an avatar size gets (COD-154): the list sizes take the pixel-snapped small drawings so the body
 * edges and the eyes land on whole pixels at device scale 1; `lg` and up are big enough for the 64-unit art.
 * The stylesheet sizes each drawing's canvas to match (`.avatar.xs .mascot` and friends).
 */
export function mascotGlyph(size: AvatarSize): MascotGlyph {
  if (size === 'xxs') return 'tiny';
  if (size === 'xs' || size === 'sm') return 'small';
  if (size === 'md') return 'medium';
  return 'large';
}

/**
 * Which renderer an avatar size gets (COD-156): a large face is the 3D solid that turns after the pointer, a small
 * one stays the flat whole-pixel glyph, because a slab a few pixels wide would blur what COD-154 made crisp.
 */
export function avatarRenderer(size: AvatarSize): 'solid' | 'glyph' {
  return size === 'lg' || size === 'xl' || size === 'xxl' ? 'solid' : 'glyph';
}
/** The size of the 64-unit drawing at each solid size, matching what the stylesheet gives the flat `.mascot`. */
export const solidSizes: Record<AvatarSize, number> = { xxs: 16, xs: 24, sm: 24, md: 30, lg: 40, xl: 64, xxl: 96 };
// `export` above only so the test can check the mapping; the functions sit after the component that uses them.

/** Overlapping worker faces for a team chat header or empty thread. */
export function RosterAvatars({ workers, size = 'xs', max = 4, alive }: { workers: readonly Worker[]; size?: 'xs' | 'sm'; max?: number; alive?: boolean }) {
  if (!workers.length) return null;
  const shown = workers.slice(0, max);
  const rest = workers.length - shown.length;
  return <span className="composer-to-avatars">
    {shown.map(worker => <Avatar key={worker.id} name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size={size} alive={alive} />)}
    {rest > 0 && <span className="roster-more" aria-hidden="true">+{rest}</span>}
  </span>;
}

type AvatarValue = { mascot?: string; letter?: true; emoji?: string; color?: string };

/** Arrow keys move and select within a radio group of buttons, like native radios. */
const radioKeys = (event: KeyboardEvent<HTMLDivElement>) => {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  if (!keys.includes(event.key)) return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]')];
  const index = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next = radios[(index + (keys.indexOf(event.key) < 2 ? 1 : radios.length - 1)) % radios.length];
  next.focus(); next.click();
};

const categoryOf = (id: MascotId) => (Object.keys(mascotCategoryIds) as MascotCategory[]).find(category => mascotCategoryIds[category].includes(id));
const categoryIcons: Record<MascotCategory, ReactNode> = {
  basic: <Smile size={16} />, office: <Briefcase size={16} />, research: <ChartColumn size={16} />, content: <PenLine size={16} />,
  quality: <ShieldCheck size={16} />, tech: <Code size={16} />, support: <Headset size={16} />,
};

/**
 * Picks an avatar with as little effort as the user wants (user decision 2026-09-17: people are lazy to choose).
 * By default nothing is needed: the preview already shows the mascot and colour that fit the name, `hint`
 * (description) and `hints` (skill name, instructions). "Gợi ý khác" steps through other fitting mascots (pushing back
 * those in `taken`, used by other workers); "Ngẫu nhiên" picks anything. "Tùy chỉnh"
 * opens the full choice: mascots by category, three suggested colours (the first is automatic), the user's saved
 * colours and a "+" colour panel that saves new ones through `onSavedColorsChange`.
 */
export function AvatarPicker({ name, seed, hint, hints, taken, value, onChange, badge, savedColors = [], onSavedColorsChange }: {
  name: string; seed: string; hint?: string; hints?: Omit<MascotHints, 'name' | 'description'>; taken?: readonly string[]; value: AvatarValue; onChange: (value: AvatarValue) => void; badge?: ReactNode;
  savedColors?: readonly string[]; onSavedColorsChange?: (colors: string[]) => void;
}) {
  const ids = useId();
  const set = (patch: AvatarValue) => onChange(Object.fromEntries(Object.entries({ ...value, ...patch }).filter(([, item]) => item !== undefined)));
  const suggestionHints = { ...hints, name, description: hint };
  const face = isMascot(value.mascot) ? value.mascot : autoMascot(mascotIds, seed, { name, description: hint });
  const [open, setOpen] = useState(false);
  const [colorPanel, setColorPanel] = useState(false);
  const [category, setCategory] = useState<MascotCategory>(() => categoryOf(face) ?? 'basic');
  // Every choice makes the preview smile (the "say cheese" of the standalone page, COD-156).
  const [cheer, setCheer] = useState(0);
  const choose = (mascot: MascotId, patch: AvatarValue = {}) => { set({ mascot, emoji: undefined, letter: undefined, ...patch }); setCategory(categoryOf(mascot) ?? 'basic'); setCheer(count => count + 1); };
  const suggest = () => {
    const options = suggestedMascots(suggestionHints, { taken });
    const next = options[(options.indexOf(face) + 1) % options.length];
    choose(next, { color: undefined });
  };
  const randomize = () => {
    const pick = <T,>(items: readonly T[], skip?: T) => { const pool = items.filter(item => item !== skip); return pool[Math.floor(Math.random() * pool.length)]; };
    choose(pick(mascotIds, face), { color: pick(avatarPalette, value.color) });
  };
  const colors = suggestedColors(face, seed, suggestionHints);
  const own = savedColors.filter(color => !colors.includes(color));
  const other = value.color && !colors.includes(value.color) && !own.includes(value.color) ? [value.color] : [];
  const saveColor = (hex: string) => { onSavedColorsChange?.([hex, ...savedColors.filter(color => color !== hex)].slice(0, 16)); set({ color: hex }); };
  const colorSwatch = (color: string, index: number, label: string) => {
    const checked = index === 0 ? !value.color || value.color === color : value.color === color;
    return <button key={color} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} className="avatar-swatch" style={{ '--avatar-color': color } as CSSProperties} aria-label={label} title={label} onClick={() => set({ color: index === 0 ? undefined : color })}>{checked && <Check size={12} strokeWidth={3} aria-hidden="true" />}</button>;
  };

  // The avatar and its quick actions share one centred row; the full choice opens below at full width. The preview
  // is a 3D face (COD-156): it hops in when the dialog opens, turns after the pointer, and smiles at every choice.
  return <div className="avatar-picker">
    <div className="avatar-picker-head">
      <Avatar name={name || '?'} seed={seed} mascot={value.mascot} defaultMascot hint={hint} color={value.color} badge={badge} size="xl" motion={{ lead: true, greet: true, cheer }} />
      <div className="avatar-picker-toolbar">
        <Button type="button" variant="outline" className="avatar-action" onClick={suggest} title={t('Chọn linh vật khác hợp với tên, mô tả và kỹ năng')}><Sparkles size={15} aria-hidden="true" />{t('Gợi ý khác')}</Button>
        <Button type="button" variant="outline" className="avatar-action" onClick={randomize}><Shuffle size={15} aria-hidden="true" />{t('Ngẫu nhiên')}</Button>
        <Button type="button" variant="outline" className="avatar-action avatar-customize" aria-expanded={open} aria-controls={`${ids}-custom`} onClick={() => { if (!open) setCategory(categoryOf(face) ?? 'basic'); setOpen(!open); }}><SlidersHorizontal size={15} aria-hidden="true" />{t('Tùy chỉnh')}<ChevronDown size={15} aria-hidden="true" /></Button>
      </div>
    </div>
    <div id={`${ids}-custom`} className="avatar-custom" hidden={!open}>
      <div className="avatar-custom-section">
        <div className="avatar-custom-heading"><span className="avatar-custom-title">{t('Linh vật')}</span>
          <Select size="sm" ariaLabel={t('Nhóm linh vật')} className="avatar-category" menuMinWidth={260} value={category} onChange={next => setCategory(next as MascotCategory)} options={(Object.keys(mascotCategoryLabels) as MascotCategory[]).map(id => ({ value: id, label: t(mascotCategoryLabels[id]), icon: categoryIcons[id] }))} />
        </div>
        <div className="avatar-choice-row mascots" role="radiogroup" aria-label={t(mascotCategoryLabels[category])} onKeyDown={radioKeys}>
          {mascotCategoryIds[category].map((id, index) => {
            const checked = face === id;
            const focusable = checked || (index === 0 && !mascotCategoryIds[category].includes(face));
            // Each tile is a 3D face that turns and hops only while the pointer or the keyboard is on it.
            return <button key={id} type="button" role="radio" aria-checked={checked} tabIndex={focusable ? 0 : -1} className="avatar-choice mascot-choice" aria-label={t(mascots[id].name)} title={t(mascots[id].name)} onClick={() => choose(id)}><Orglet3D id={id} seed={index} size={32} color="grid" motion={{ follow: 'hover' }} /></button>;
          })}
        </div>
      </div>
      <div className="avatar-custom-section">
        <span className="avatar-custom-title">{t('Màu')}</span>
        <div className="avatar-color-row">
          <div className="avatar-choice-row" role="radiogroup" aria-label={t('Màu')} onKeyDown={radioKeys}>
            {colors.map((color, index) => colorSwatch(color, index, index === 0 ? t('Màu gợi ý {0} (tự động)', [color]) : t('Màu gợi ý {0}', [color])))}
            {[...own, ...other].map(color => colorSwatch(color, -1, own.includes(color) ? t('Màu của bạn {0}', [color]) : t('Màu {0}', [color])))}
          </div>
          <button type="button" className="avatar-swatch avatar-swatch-add" aria-label={t('Tạo màu')} title={t('Tạo màu')} aria-expanded={colorPanel} aria-controls={`${ids}-colors`} onClick={() => setColorPanel(!colorPanel)}><Plus size={14} strokeWidth={2.5} aria-hidden="true" /></button>
        </div>
        {colorPanel && <ColorPicker id={`${ids}-colors`} value={value.color ?? colors[0]} onChange={color => set({ color })} presets={colorPresets} saved={savedColors} onSave={saveColor}
          onRemove={color => onSavedColorsChange?.(savedColors.filter(item => item !== color))} onClose={() => { setColorPanel(false); document.querySelector<HTMLButtonElement>(`[aria-controls="${ids}-colors"]`)?.focus(); }} />}
      </div>
    </div>
  </div>;
}
