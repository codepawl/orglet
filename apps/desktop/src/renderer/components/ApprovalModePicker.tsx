import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, FileDiff, FolderCheck, ListTodo, type LucideIcon } from 'lucide-react';
import { AnchoredPopover } from './AnchoredPopover';
import { approvalModeOf, approvalModes, capabilitiesForMode, changesMode, folderNeedFor, type ApprovalMode, type FolderNeed } from '../../shared/approval-mode';
import type { ToolCapability } from '../../shared/tool-policy';
import type { WorkspaceLevel } from '../../shared/capability-status';
import { setPlanFirst, usePlanFirst } from '../planFirst';
import { t, translated } from '../i18n';
import { Button } from './ui';
import { MessageBoxFocus } from './SourcePicker';

const modeNames: Record<ApprovalMode, string> = translated({
  ask: 'Hỏi trước khi áp dụng',
  apply: 'Tự áp dụng thay đổi',
  plan: 'Lên kế hoạch trước',
});

const modeDescriptions: Record<ApprovalMode, string> = translated({
  ask: 'Thay đổi chờ bạn xem rồi mới vào thư mục.',
  apply: 'Thay đổi vào thư mục khi Tí làm xong.',
  plan: 'Chỉ đọc và gửi kế hoạch, chưa sửa gì.',
});

const folderNeedNotes: Record<Exclude<FolderNeed, undefined>, string> = translated({
  pick: 'Cần thư mục làm việc · chọn để thêm',
  edit: 'Cần quyền sửa thư mục · chọn để cho phép',
});

const modeIcons: Record<ApprovalMode, LucideIcon> = { ask: FileDiff, apply: FolderCheck, plan: ListTodo };

/** One row's state: why it cannot be chosen here, or what choosing it asks for first. */
export type ModeRowState = { locked?: string; folderNeed?: FolderNeed };

/**
 * The approval mode beside the add button under the prompt bar (COD-367, from the owner's reference of Claude Code's
 * mode menu): a quiet button naming the current mode, opening a menu titled Mode with one row per mode, its one-line
 * description under the name and its number at the end, a check on the current one. Arrows and Enter move and choose,
 * and 1, 2, 3 choose while the menu is open. A row that needs a working folder says so and still takes the click: the
 * parent then asks for the folder. A locked row (a side thread's permissions, a crew's hand-in) says why and does nothing.
 * Props in, choice out: the parent owns what a mode means.
 */
export function ApprovalModePicker({ mode, rows, disabled, onSelect }: {
  mode: ApprovalMode;
  rows: Record<ApprovalMode, ModeRowState>;
  disabled?: boolean;
  onSelect: (mode: ApprovalMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const focusMessageBox = useContext(MessageBoxFocus);
  const CurrentIcon = modeIcons[mode];

  const close = () => setOpen(false);
  // The popover focuses its first row once placed; the current mode is where the keyboard should start, as in a radio group.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const choose = (chosen: ApprovalMode) => {
    if (rows[chosen].locked !== undefined) return;
    close();
    if (focusMessageBox) focusMessageBox();
    else trigger.current?.focus();
    onSelect(chosen);
  };
  const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])];
  const moveFocus = (step: number | 'first' | 'last') => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (step === 'first') next = 0;
    else if (step === 'last') next = all.length - 1;
    else next = (index + step + all.length) % all.length;
    all[next]?.focus();
  };
  const onMenuKey = (event: KeyboardEvent) => {
    const number = Number(event.key);
    if (Number.isInteger(number) && number >= 1 && number <= approvalModes.length) {
      event.preventDefault();
      choose(approvalModes[number - 1]);
      return;
    }
    const moves: Record<string, number | 'first' | 'last'> = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' };
    if (event.key in moves) {
      event.preventDefault();
      moveFocus(moves[event.key]);
    }
  };

  return <>
    <Button ref={trigger} type="button" variant="ghost" className="composer-mode" disabled={disabled}
      aria-haspopup="menu" aria-expanded={open} aria-label={t('Chế độ: {0}', [modeNames[mode]])} title={modeDescriptions[mode]}
      onClick={() => setOpen(current => !current)}>
      <CurrentIcon size={14} aria-hidden="true" />
      <span className="composer-mode-name">{modeNames[mode]}</span>
      <ChevronDown size={14} className="composer-mode-chevron" aria-hidden="true" />
    </Button>
    <AnchoredPopover anchor={trigger} open={open} onClose={close} label={t('Chế độ')} className="mode-menu">
      <p className="mode-menu-title" id={titleId}>{t('Chế độ')}</p>
      {/* Tab out of the menu closes it, as the + menu beside it does, so no menu is left open behind the focus. */}
      <div ref={menu} role="menu" aria-labelledby={titleId} onKeyDown={onMenuKey}
        onBlur={event => { if (!menu.current?.contains(event.relatedTarget as Node | null) && event.relatedTarget !== trigger.current) close(); }}>
        {approvalModes.map((item, index) => {
          const Icon = modeIcons[item];
          const state = rows[item];
          const current = item === mode;
          const note = state.locked ?? (state.folderNeed ? folderNeedNotes[state.folderNeed] : modeDescriptions[item]);
          return <button key={item} type="button" role="menuitemradio" aria-checked={current} aria-disabled={state.locked !== undefined || undefined}
            tabIndex={current ? 0 : -1} aria-keyshortcuts={String(index + 1)} className="mode-option" onClick={() => choose(item)}>
            <Icon size={16} aria-hidden="true" className="mode-option-icon" />
            <span className="mode-option-text">
              <span className="mode-option-name">{modeNames[item]}</span>
              <span className="mode-option-note">{note}</span>
            </span>
            <Check size={15} aria-hidden="true" className="mode-option-check" />
            <kbd className="mode-option-key" aria-hidden="true">{index + 1}</kbd>
          </button>;
        })}
      </div>
    </AnchoredPopover>
  </>;
}

/** What choosing a mode asks of the chat: new permissions, and a folder to pick or edit access to grant, in that order. */
export type ModeChange = { capabilities?: ToolCapability[]; folder?: Exclude<FolderNeed, undefined> };

/** Why a mode cannot be chosen in this chat, or undefined when it can. */
function modeLock(input: { item: Exclude<ApprovalMode, 'plan'>; current: Exclude<ApprovalMode, 'plan'>; sideThread: boolean; appliesAtOnce: boolean }): string | undefined {
  if (input.item === input.current) return undefined;
  if (input.sideThread) return t('Chat phụ dùng quyền của chat chính. Đổi ở chat chính.');
  if (input.appliesAtOnce) return t('Kênh áp dụng thay đổi của từng Tí ngay khi Tí đó xong.');
  return undefined;
}

/**
 * The picker bound to one chat's message bar. Ask before applying and Apply changes are the chat's `workspace.apply`,
 * the value Details shows as Review before applying, so changing either control shows in the other; Plan first is the
 * bar's own choice for its next message (`planFirst.ts`). A crew or a channel hands each orglet's changes in as it
 * finishes, so Ask is locked there; a side thread takes its permissions from its main chat, so only its current mode
 * and Plan first can be chosen there.
 */
export function ChatModePicker({ planKey, capabilities, level, appliesAtOnce, sideThread, disabled, onChange }: {
  /** The bar's key (`task:<id>` or an empty chat's), which Plan first is kept under. */
  planKey: string | undefined;
  capabilities: readonly ToolCapability[];
  level: WorkspaceLevel;
  /** A crew or a channel: changes reach the folder as each orglet finishes. */
  appliesAtOnce: boolean;
  sideThread: boolean;
  disabled?: boolean;
  onChange: (change: ModeChange) => void;
}) {
  const planFirst = usePlanFirst(planKey);
  const current = changesMode(capabilities, appliesAtOnce);
  const mode = approvalModeOf({ capabilities, planFirst, appliesAtOnce });
  const rowFor = (item: Exclude<ApprovalMode, 'plan'>): ModeRowState => {
    const locked = modeLock({ item, current, sideThread, appliesAtOnce });
    if (locked !== undefined) return { locked };
    // A side thread cannot widen its folder either; its main chat owns that.
    return { folderNeed: sideThread ? undefined : folderNeedFor(item, level) };
  };
  const rows: Record<ApprovalMode, ModeRowState> = { ask: rowFor('ask'), apply: rowFor('apply'), plan: {} };
  const select = (chosen: ApprovalMode) => {
    setPlanFirst(planKey, chosen === 'plan');
    if (chosen === 'plan') return;
    const change: ModeChange = {};
    if (chosen !== current) change.capabilities = capabilitiesForMode(capabilities, chosen);
    const need = rows[chosen].folderNeed;
    if (need) change.folder = need;
    if (change.capabilities || change.folder) onChange(change);
  };
  return <ApprovalModePicker mode={mode} rows={rows} disabled={disabled} onSelect={select} />;
}
