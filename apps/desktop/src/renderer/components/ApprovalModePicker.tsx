import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, FileDiff, FolderCheck, ListTodo, ShieldOff, TriangleAlert, Zap, type LucideIcon } from 'lucide-react';
import { AnchoredPopover } from './AnchoredPopover';
import { approvalModeOf, approvalModes, capabilitiesForMode, changesMode, folderNeedFor, type ApprovalMode, type ChangesMode, type FolderNeed } from '../../shared/approval-mode';
import type { ToolCapability } from '../../shared/tool-policy';
import type { WorkspaceLevel } from '../../shared/capability-status';
import { setPlanFirst, usePlanFirst } from '../planFirst';
import { useDecisionModelSetting } from '../decisionModelSetting';
import { decisionModelMissing, modeNames, modeRowNote, needsBypassConfirmation, type ModeRowState } from '../approvalModeText';
import { t } from '../i18n';
import { Button } from './ui';
import { confirmAction } from './confirm';
import { MessageBoxFocus } from './SourcePicker';

const modeIcons: Record<ApprovalMode, LucideIcon> = { auto: Zap, manual: FileDiff, acceptEdits: FolderCheck, plan: ListTodo, bypass: ShieldOff };

export type { ModeRowState };

/**
 * The approval mode beside the add button under the prompt bar (COD-367, from the owner's reference of Claude Code's
 * mode menu): a quiet button naming the current mode, opening a menu titled Mode with one row per mode, its one-line
 * description under the name and its number at the end, a check on the current one. Arrows and Enter move and choose,
 * and 1 to 5 choose while the menu is open. A row that needs a working folder says so and still takes the click: the
 * parent then asks for the folder. A locked row (a side thread's permissions, a crew's hand-in) says why and does nothing.
 * Props in, choice out: the parent owns what a mode means.
 */
export function ApprovalModePicker({ mode, rows, disabled, onSelect }: {
  mode: ApprovalMode;
  rows: Record<ApprovalMode, ModeRowState>;
  disabled?: boolean;
  onSelect: (mode: ApprovalMode) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const focusMessageBox = useContext(MessageBoxFocus);
  // While Bypass is on the bar says so without opening the menu: a warning mark that no other mode wears.
  const CurrentIcon = mode === 'bypass' ? TriangleAlert : modeIcons[mode];

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
    <Button ref={trigger} type="button" variant="ghost" className={mode === 'bypass' ? 'composer-mode composer-mode-bypass' : 'composer-mode'} disabled={disabled}
      aria-haspopup="menu" aria-expanded={open} aria-label={t('Chế độ: {0}', [modeNames[mode]])}
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
          const note = modeRowNote(item, state);
          return <button key={item} type="button" role="menuitemradio" aria-checked={current} aria-disabled={state.locked !== undefined || undefined}
            tabIndex={current ? 0 : -1} aria-keyshortcuts={String(index + 1)} className="mode-option" onClick={() => choose(item)}>
            <Icon size={16} aria-hidden="true" className="mode-option-icon" />
            <span className="mode-option-text">
              <span className="mode-option-name">{modeNames[item]}{item === 'auto' && <span className="mode-option-badge">{t('Mặc định')}</span>}</span>
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
function modeLock(input: { item: ChangesMode; current: ChangesMode; sideThread: boolean; appliesAtOnce: boolean }): string | undefined {
  if (input.item === input.current) return undefined;
  if (input.sideThread) return t('Chat phụ dùng quyền của chat chính. Đổi ở chat chính.');
  if (input.appliesAtOnce) return t('Kênh áp dụng thay đổi của từng Tí ngay khi Tí đó xong.');
  return undefined;
}

/**
 * The picker bound to one chat's message bar. Manual and Accept edits are the chat's `workspace.apply` (what Details
 * shows as Review before applying, so changing either control shows in the other); Auto and Bypass add `approval.auto`
 * or `approval.bypass` to it, and Bypass asks once before it is turned on. Plan is the bar's own choice for its next
 * message (`planFirst.ts`). A crew or a channel hands each orglet's changes in as it finishes, so only its own mode
 * is open there; a side thread takes its permissions from its main chat, so only its current mode and Plan can be chosen.
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
  const noDecisionModel = decisionModelMissing(useDecisionModelSetting());
  const current = changesMode(capabilities, appliesAtOnce);
  const mode = approvalModeOf({ capabilities, planFirst, appliesAtOnce });
  const rowFor = (item: ChangesMode): ModeRowState => {
    const locked = modeLock({ item, current, sideThread, appliesAtOnce });
    if (locked !== undefined) return { locked };
    // A side thread cannot widen its folder either; its main chat owns that.
    return { folderNeed: sideThread ? undefined : folderNeedFor(item, level), decisionModelMissing: noDecisionModel };
  };
  const rows: Record<ApprovalMode, ModeRowState> = {
    auto: rowFor('auto'), manual: rowFor('manual'), acceptEdits: rowFor('acceptEdits'), plan: {}, bypass: rowFor('bypass'),
  };
  const select = async (chosen: ApprovalMode) => {
    if (needsBypassConfirmation(chosen, current)) {
      const confirmed = await confirmAction({
        title: t('Bật Bỏ qua quyền cho chat này?'),
        description: t('Orglet sẽ không hỏi trước khi gọi công cụ, thao tác trên trang và ứng dụng, hay mượn chuột.'),
        confirmLabel: t('Bật chế độ'),
      });
      if (!confirmed) return;
    }
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
