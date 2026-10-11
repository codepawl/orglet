import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Plus, SlidersHorizontal, Sparkles } from 'lucide-react';
import { t } from '../i18n';
import { Mascot, bodyNames, eyesNames, type MascotGlyph } from './mascots';
import { bodyShapeIds } from './orgletShapes';
import { avatarPalette, defaultAvatarColor, lookColor, seedHash, shownLook, suggestedColors, suggestedLooks, type MascotHints } from './mascotSuggest';
import { EYE_IDS, formatLook, sameLook, type OrgletLook } from '../../shared/orglet-look';
import { Orglet3D, type FaceMotion } from './Orglet3D';
import { ColorPicker } from './ColorPicker';
import { Button } from './ui';
import type { Worker } from '../../shared/contracts';
import { Tooltip } from '@codepawlhq/orglet-ui';

export { avatarPalette };
export type { FaceMotion };
/** `xxs` is the 16px read receipt, `xxl` the greeting of an empty chat; the others are the sizes the stylesheet names. */
export type AvatarSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
export const avatarColor = (seed: string, color?: string) => color ?? avatarPalette[seedHash(seed) % avatarPalette.length];
// Presets in the colour panel: the identity palette plus deeper office tones.
const colorPresets = [...avatarPalette, '#2f4b7c', '#3d4451', '#2e7d5b', '#9b3d5a', '#b8862b', '#3b9ad9', '#8a7bd8', '#8d6e63'];

/**
 * Orglet avatar for a worker, channel or other named entity: always an orglet, a body and a pair of eyes in the
 * entity's colour (owner, 2026-10-12: nothing but an orglet stands for an orglet), with an optional small badge (for
 * example the provider mark) in the corner. The look is the one stored in `mascot`; an entity that picked nothing
 * gets the look suggested by its name and `hint` (its description), in that look's colour, so every worker has a
 * fitting face without choosing anything.
 * Decorative: the name is always shown next to it, so it is hidden from assistive technology.
 * `seed` should be a stable id so renaming does not change an automatic choice among equals.
 */
export function Avatar({ name, seed, mascot, hint, color, badge, size = 'md', shape = 'rounded', alive, motion }: {
  name: string; seed?: string; mascot?: string; hint?: string; color?: string; badge?: ReactNode; size?: AvatarSize; shape?: 'rounded' | 'circle';
  /** Blinks now and then. Only for the handful of faces in the chat you are reading, never a whole list at once. */
  alive?: boolean;
  /** How a large (`lg` and up) face behaves; see `Orglet3D`. The small sizes ignore it: their motion is the stylesheet's. */
  motion?: FaceMotion;
}) {
  const look = shownLook(mascot, seed ?? name, { name, description: hint });
  const ink = color ?? lookColor(look);
  // Each face waits its own share of the idle cycle before blinking, so two of them never blink together, and
  // looks up towards its own side, so two faces on one screen never mirror each other.
  const hash = seedHash(seed ?? name);
  const idleDelay = `-${hash % IDLE_SECONDS}s`;
  const idleSide = hash % 2 === 0 ? 1 : -1;
  return <span className={`avatar ${size} ${shape} has-mascot${alive ? ' alive' : ''}`}
    style={{ '--avatar-color': ink, '--idle-delay': idleDelay, '--idle-side': idleSide } as CSSProperties} aria-hidden="true">
    <span className="avatar-face">{avatarRenderer(size) === 'solid' ? <Orglet3D look={look} seed={hash} size={solidSizes[size]} color={ink} motion={motion} /> : <Mascot look={look} glyph={mascotGlyph(size)} />}</span>
    {badge && <span className="avatar-badge">{badge}</span>}
  </span>;
}

/**
 * The colour a worker's face is drawn in, exactly as `Avatar` picks it: the colour the person set, or the colour of
 * its look. The orglet's cursor and the desktop glow's peek use it, so they match its avatar.
 */
export function workerInk(worker: { id: string; name: string; description?: string; avatar?: { mascot?: string; color?: string } }): string {
  return defaultAvatarColor(worker);
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

/**
 * Overlapping worker faces for a team chat header or empty thread. `countRest` false drops the "+N" after the faces,
 * for a row whose name needs that width more than a headcount (the sidebar's crew rows, COD-256).
 */
export function RosterAvatars({ workers, size = 'xs', max = 4, alive, countRest = true }: { workers: readonly Worker[]; size?: 'xs' | 'sm'; max?: number; alive?: boolean; countRest?: boolean }) {
  if (!workers.length) return null;
  const shown = workers.slice(0, max);
  const rest = workers.length - shown.length;
  return <span className="composer-to-avatars">
    {shown.map(worker => <Avatar key={worker.id} name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} hint={worker.description} color={worker.avatar?.color} size={size} alive={alive} />)}
    {countRest && rest > 0 && <span className="roster-more" aria-hidden="true">+{rest}</span>}
  </span>;
}

/** What the picker edits: the stored look and colour. An old emoji or letter is accepted by the schema and ignored here. */
type AvatarValue = { mascot?: string; color?: string };

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

/** One swatch of the body or the eyes group: the look it would give, drawn in the current colour. */
function LookChoice({ label, look, seed, ink, checked, onChoose }: { label: string; look: OrgletLook; seed: number; ink: string; checked: boolean; onChoose: (look: OrgletLook) => void }) {
  return <Tooltip label={label}><button type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} className="avatar-choice mascot-choice" aria-label={label} onClick={() => onChoose(look)}><Orglet3D look={look} seed={seed} size={32} color={ink} motion={{ follow: 'hover' }} /></button></Tooltip>;
}

/**
 * Picks an avatar with as little effort as the user wants (user decision 2026-09-17: people are lazy to choose).
 * By default nothing is needed: the preview already shows the look and colour that fit the name, `hint`
 * (description) and `hints` (skill name, instructions). "Gợi ý khác" steps through other fitting looks (pushing back
 * those in `taken`, used by other workers). "Tùy chỉnh" opens the full choice, three groups in this order: the body,
 * the eyes, and the colour (three suggested colours, the first is automatic, the user's saved colours and a "+"
 * colour panel that saves new ones through `onSavedColorsChange`). Choosing one changes only that part.
 */
export function AvatarPicker({ name, seed, hint, hints, taken, value, onChange, badge, savedColors = [], onSavedColorsChange }: {
  name: string; seed: string; hint?: string; hints?: Omit<MascotHints, 'name' | 'description'>; taken?: readonly OrgletLook[]; value: AvatarValue; onChange: (value: AvatarValue) => void; badge?: ReactNode;
  savedColors?: readonly string[]; onSavedColorsChange?: (colors: string[]) => void;
}) {
  const ids = useId();
  // Only the look and the colour are written: a value that still carries an old emoji or letter drops them here.
  const set = (patch: AvatarValue) => {
    const next = { mascot: value.mascot, color: value.color, ...patch };
    onChange(Object.fromEntries(Object.entries(next).filter(([, item]) => item !== undefined)));
  };
  const suggestionHints = { ...hints, name, description: hint };
  const look = shownLook(value.mascot, seed, { name, description: hint });
  const [open, setOpen] = useState(false);
  const [colorPanel, setColorPanel] = useState(false);
  // Every choice makes the preview smile (the "say cheese" of the standalone page, COD-156).
  const [cheer, setCheer] = useState(0);
  const choose = (next: OrgletLook, patch: AvatarValue = {}) => { set({ mascot: formatLook(next), ...patch }); setCheer(count => count + 1); };
  const suggest = () => {
    const options = suggestedLooks(suggestionHints, { taken });
    const current = options.findIndex(option => sameLook(option, look));
    choose(options[(current + 1) % options.length], { color: undefined });
  };
  const colors = suggestedColors(look, seed, suggestionHints);
  const ink = value.color ?? colors[0];
  const own = savedColors.filter(color => !colors.includes(color));
  const other = value.color && !colors.includes(value.color) && !own.includes(value.color) ? [value.color] : [];
  const saveColor = (hex: string) => { onSavedColorsChange?.([hex, ...savedColors.filter(color => color !== hex)].slice(0, 16)); set({ color: hex }); };
  const colorSwatch = (color: string, index: number, label: string) => {
    const checked = index === 0 ? !value.color || value.color === color : value.color === color;
    return <Tooltip label={label} key={color}><button type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} className="avatar-swatch" style={{ '--avatar-color': color } as CSSProperties} aria-label={label} onClick={() => set({ color: index === 0 ? undefined : color })}>{checked && <Check size={12} strokeWidth={3} aria-hidden="true" />}</button></Tooltip>;
  };

  // The avatar and its quick actions share one centred row; the full choice opens below at full width. The preview
  // is a 3D face (COD-156): it hops in when the dialog opens, turns after the pointer, and smiles at every choice.
  return <div className="avatar-picker">
    <div className="avatar-picker-head">
      <Avatar name={name || '?'} seed={seed} mascot={value.mascot} hint={hint} color={value.color} badge={badge} size="xl" motion={{ lead: true, greet: true, cheer }} />
      <div className="avatar-picker-toolbar">
        <Tooltip label={t('Chọn dáng và mắt khác hợp với tên, mô tả và kỹ năng')}><Button type="button" variant="outline" className="avatar-action" onClick={suggest}><Sparkles size={15} aria-hidden="true" />{t('Gợi ý khác')}</Button></Tooltip>
        <Button type="button" variant="outline" className="avatar-action avatar-customize" aria-expanded={open} aria-controls={`${ids}-custom`} onClick={() => setOpen(!open)}><SlidersHorizontal size={15} aria-hidden="true" />{t('Tùy chỉnh')}<ChevronDown size={15} aria-hidden="true" /></Button>
      </div>
    </div>
    <div id={`${ids}-custom`} className="avatar-custom" hidden={!open}>
      <div className="avatar-custom-section">
        <span className="avatar-custom-title">{t('Dáng')}</span>
        <div className="avatar-choice-row looks body-choices" role="radiogroup" aria-label={t('Dáng')} onKeyDown={radioKeys}>
          {bodyShapeIds.map((body, index) => {
            const checked = look.body === body;
            // Each tile is the body with the current eyes and colour, a 3D face that turns and hops only while the pointer or the keyboard is on it.
            return <LookChoice key={body} label={bodyNames[body]()} look={{ body, eyes: look.eyes }} seed={index} ink={ink} checked={checked} onChoose={choose} />;
          })}
        </div>
      </div>
      <div className="avatar-custom-section">
        <span className="avatar-custom-title">{t('Mắt')}</span>
        <div className="avatar-choice-row looks eyes-choices" role="radiogroup" aria-label={t('Mắt')} onKeyDown={radioKeys}>
          {EYE_IDS.map((eyes, index) => {
            const checked = look.eyes === eyes;
            return <LookChoice key={eyes} label={eyesNames[eyes]()} look={{ body: look.body, eyes }} seed={index} ink={ink} checked={checked} onChoose={choose} />;
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
          <Tooltip label={t('Tạo màu')}><button type="button" className="avatar-swatch avatar-swatch-add" aria-label={t('Tạo màu')} aria-haspopup="dialog" aria-expanded={colorPanel} aria-controls={`${ids}-colors`} onClick={() => setColorPanel(!colorPanel)}><Plus size={14} strokeWidth={2.5} aria-hidden="true" /></button></Tooltip>
        </div>
        {colorPanel && <ColorPicker id={`${ids}-colors`} value={value.color ?? colors[0]} onChange={color => set({ color })} presets={colorPresets} saved={savedColors} onSave={saveColor}
          onRemove={color => onSavedColorsChange?.(savedColors.filter(item => item !== color))} onClose={() => { setColorPanel(false); document.querySelector<HTMLButtonElement>(`[aria-controls="${ids}-colors"]`)?.focus(); }} />}
      </div>
    </div>
  </div>;
}
