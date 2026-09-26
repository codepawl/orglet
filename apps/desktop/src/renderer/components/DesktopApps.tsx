import { useEffect, useState } from 'react';
import { Camera, Check, ChevronsUpDown, Image, List, ListChecks, MonitorSmartphone, MousePointerClick, MoveVertical, Plus, ScanSearch, ShieldAlert, TextCursorInput, ToggleRight, X, type LucideIcon } from 'lucide-react';
import { Skeleton, SkeletonGroup } from '@codepawl/orglet-ui';
import type { TaskDetail } from '../../shared/contracts';
import { defaultDesktopChoice, type DesktopAction, type DesktopActionKind, type DesktopActKind, type DesktopApprovalView, type DesktopChoice, type DesktopWindowView } from '../../shared/desktop';
import { Button, Drawer } from './ui';
import { currentLocale, t, tMessage, translated } from '../i18n';
import { orglet } from '../api';
import { toast } from './toast';

/*
 * Desktop apps in the window (COD-261, phase 2a): which programs a chat may see and use, picked from the windows open
 * now, the chat's desktop steps in Details, and the card that asks about one consequential step. The window only shows
 * state and sends the person's choices; the core decides every step.
 */

/** Desktop apps work through Windows UI Automation, so only Windows has them. */
export function desktopAppsAvailable(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
}

/** One program as the lists show it: the name the picker saw, then its file name when that says something more. */
function programLine(name: string, program: string): string {
  return name.toLowerCase() === program ? program : `${name} · ${program}`;
}

/**
 * The picker: the windows open now, one row per program with its window titles, and Add for each. A program that runs
 * as administrator is shown but cannot be added, since UI Automation cannot reach it.
 */
function DesktopAppPicker({ granted, onAdd, onClose }: { granted: DesktopChoice; onAdd: (program: string, name: string) => void; onClose: () => void }) {
  const [windows, setWindows] = useState<DesktopWindowView[]>();
  const [failed, setFailed] = useState('');
  useEffect(() => {
    let live = true;
    void orglet.call('desktopWindows', {}).then(view => { if (live) setWindows(view.windows); })
      .catch(error => { if (live) setFailed(tMessage(String(error))); });
    return () => { live = false; };
  }, []);
  const grantedPrograms = new Set(granted.apps.map(app => app.program));
  const programs = new Map<string, DesktopWindowView[]>();
  for (const window of windows ?? []) programs.set(window.program, [...programs.get(window.program) ?? [], window]);
  return <Drawer open onClose={onClose} title={t('Thêm ứng dụng')} description={t('Tí chỉ thấy cửa sổ của ứng dụng bạn thêm. Mở ứng dụng trước, rồi chọn ở đây.')}>
    {!windows && !failed && <SkeletonGroup label={t('Đang tìm cửa sổ đang mở')}>
      <Skeleton width="60%" /><Skeleton width="45%" /><Skeleton width="52%" />
    </SkeletonGroup>}
    {failed && <p className="error" role="alert">{failed}</p>}
    {windows && programs.size === 0 && <p className="muted">{t('Không có cửa sổ nào đang mở.')}</p>}
    {programs.size > 0 && <ul className="desktop-picker" aria-label={t('Cửa sổ đang mở')}>
      {[...programs.entries()].map(([program, programWindows]) => {
        const elevated = programWindows.every(window => window.elevated);
        const added = grantedPrograms.has(program);
        const name = programWindows[0].title;
        return <li key={program} className="desktop-picker-row">
          <MonitorSmartphone size={16} aria-hidden="true" />
          <span className="desktop-picker-text">
            <span className="desktop-picker-title" title={name}>{name}</span>
            <span className="desktop-picker-meta">{elevated ? t('{0} · chạy quyền quản trị, Tí không dùng được', [program])
              : programWindows.length > 1 ? t('{0} · {1} cửa sổ', [program, programWindows.length]) : program}</span>
          </span>
          {added
            ? <span className="desktop-picker-added"><Check size={14} aria-hidden="true" />{t('Đã thêm')}</span>
            : <Button variant="outline" disabled={elevated} aria-label={t('Thêm {0}', [program])} onClick={() => onAdd(program, name.slice(0, 120))}><Plus size={14} />{t('Thêm')}</Button>}
        </li>;
      })}
    </ul>}
  </Drawer>;
}

/**
 * A chat's desktop apps in Details, beside its browser: the programs it granted, each with a remove button, and Add
 * app. Shown only while the chat may read windows. A side thread shows its main chat's apps and cannot change them.
 */
export function DesktopChatSettings({ detail }: { detail: TaskDetail }) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  if (!desktopAppsAvailable() || !detail.task.toolCapabilities?.includes('desktop.read')) return null;
  const choice = detail.task.desktop ?? defaultDesktopChoice();
  const side = Boolean(detail.task.sideOf);
  const save = (next: DesktopChoice) => {
    setBusy(true);
    void orglet.call('setDesktop', { taskId: detail.task.id, desktop: next })
      .catch(error => toast(tMessage(String(error)), 'error', t('Ứng dụng trên máy')))
      .finally(() => setBusy(false));
  };
  return <div className="permissions desktop-chat">
    <div className="browser-chat-sites">
      <p className="permission-folder-title"><MonitorSmartphone size={15} aria-hidden="true" />{t('Ứng dụng được cấp')}</p>
      <p className="permission-folder-description">{t('Tí chỉ thấy cửa sổ của các ứng dụng này và dùng chúng qua UI Automation, không dùng chuột hay bàn phím thật.')}</p>
      {choice.apps.length > 0 && <ul className="browser-site-list" aria-label={t('Ứng dụng được cấp')}>
        {choice.apps.map(app => <li key={app.program} className="browser-site">
          <MonitorSmartphone size={14} aria-hidden="true" />
          <span className="browser-site-name desktop-app-name" title={programLine(app.name, app.program)}>{programLine(app.name, app.program)}</span>
          <Button type="button" size="icon" disabled={busy || side} aria-label={t('Bỏ {0} khỏi danh sách', [app.program])} title={t('Bỏ {0} khỏi danh sách', [app.program])}
            onClick={() => save({ apps: choice.apps.filter(item => item.program !== app.program) })}><X size={14} /></Button>
        </li>)}
      </ul>}
      {!side && <div className="actions desktop-chat-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={() => setPicking(true)}><Plus size={14} />{t('Thêm ứng dụng')}</Button>
      </div>}
    </div>
    {side && <p className="muted permission-footnote">{t('Chat phụ dùng ứng dụng của chat chính. Đổi ở chat chính.')}</p>}
    {picking && <DesktopAppPicker granted={choice} onClose={() => setPicking(false)} onAdd={(program, name) => {
      if (choice.apps.some(app => app.program === program)) return;
      save({ apps: [...choice.apps, { program, name, addedAt: new Date().toISOString() }] });
    }} />}
  </div>;
}

const stepIcons: Record<DesktopActionKind, LucideIcon> = {
  windows: List, snapshot: MonitorSmartphone, find: ScanSearch, screenshot: Camera,
  invoke: MousePointerClick, set_value: TextCursorInput, toggle: ToggleRight, expand: ChevronsUpDown, collapse: ChevronsUpDown, select: ListChecks, scroll_into_view: MoveVertical,
};

const ELEMENT_CHARACTERS = 48;

function shortText(text: string): string {
  const characters = Array.from(text);
  return characters.length > ELEMENT_CHARACTERS ? `${characters.slice(0, ELEMENT_CHARACTERS - 1).join('').trimEnd()}…` : text;
}

const actingKinds: readonly DesktopActionKind[] = ['invoke', 'set_value', 'toggle', 'expand', 'collapse', 'select', 'scroll_into_view'];

/**
 * The step in words: what the orglet did to which element, or meant to do when it did not go through. The window it
 * happened in goes on the quieter line under it, since a window title is often long.
 */
function stepLabel(action: DesktopAction): string {
  const element = action.target ? shortText(action.target) : '';
  if (actingKinds.includes(action.kind) && action.outcome !== 'done') return element ? t('Định thao tác “{0}”', [element]) : t('Định thao tác');
  if (action.kind === 'windows') return t('Xem các cửa sổ được phép');
  if (action.kind === 'snapshot') return t('Đọc nội dung cửa sổ');
  if (action.kind === 'find') return t('Tìm trong cửa sổ');
  if (action.kind === 'screenshot') return t('Chụp cửa sổ');
  if (action.kind === 'invoke') return t('Bấm “{0}”', [element]);
  if (action.kind === 'set_value') return t('Nhập vào “{0}”', [element]);
  if (action.kind === 'toggle') return t('Bật/tắt “{0}”', [element]);
  if (action.kind === 'expand') return t('Mở rộng “{0}”', [element]);
  if (action.kind === 'collapse') return t('Thu gọn “{0}”', [element]);
  if (action.kind === 'select') return t('Chọn “{0}”', [element]);
  return t('Cuộn tới “{0}”', [element]);
}

/** The window a step happened in, as the quiet line names it. */
function stepWindow(action: DesktopAction): string | undefined {
  if (action.window) return shortText(action.window);
  return action.program ?? undefined;
}

const outcomeNames: Record<Exclude<DesktopAction['outcome'], 'done'>, string> = translated({ refused: 'bị chặn', failed: 'không thành', unknown: 'chưa rõ kết quả', declined: 'bạn không cho phép' });

function stepMeta(action: DesktopAction, askingActionId: string | undefined): string[] {
  if (action.id === askingActionId) return [t('hỏi trước'), t('đang chờ bạn')];
  const meta: string[] = [];
  const asked = action.risk === 'consequential' && (action.outcome === 'done' || action.outcome === 'declined');
  if (action.risk === 'input') meta.push(t('nhập liệu'));
  if (asked) meta.push(t('hỏi trước'));
  if (asked && action.outcome === 'done') meta.push(t('đã cho phép'));
  if (action.outcome !== 'done') meta.push(outcomeNames[action.outcome]);
  return meta;
}

/** The desktop steps of this chat in Details, newest first, each with its window and what came of it. */
export function DesktopSteps({ detail }: { detail: TaskDetail }) {
  const [actions, setActions] = useState<DesktopAction[]>();
  const [shown, setShown] = useState<{ url: string; label: string }>();
  const eventCount = detail.events.length;
  const askingActionId = detail.desktop?.approval?.actionId;
  useEffect(() => {
    let live = true;
    void orglet.call('desktopActions', { taskId: detail.task.id }).then(next => { if (live) setActions(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [detail.task.id, eventCount, askingActionId]);
  useEffect(() => () => { if (shown) URL.revokeObjectURL(shown.url); }, [shown]);
  if (!actions?.length) return null;
  const openShot = (action: DesktopAction) => void orglet.call('desktopScreenshot', { taskId: detail.task.id, id: action.screenshotId! }).then(shot => {
    const url = URL.createObjectURL(new Blob([shot.bytes as BlobPart], { type: shot.mimeType }));
    setShown({ url, label: [stepLabel(action), stepWindow(action)].filter(Boolean).join(' · ') });
  }).catch(error => toast(tMessage(String(error)), 'error', t('Ảnh cửa sổ')));
  const recent = [...actions].reverse().filter(action => action.kind !== 'windows').slice(0, 12);
  if (!recent.length) return null;
  return <section className="details-section browser-steps" aria-labelledby="desktop-steps-heading">
    <h3 id="desktop-steps-heading"><MonitorSmartphone size={15} aria-hidden="true" />{t('Ứng dụng trên máy')}</h3>
    <ol className="browser-step-list">
      {recent.map(action => {
        const Icon = stepIcons[action.kind];
        const window = stepWindow(action);
        const meta = [...window ? [window] : [], ...stepMeta(action, askingActionId)];
        const quiet = action.outcome !== 'done' && action.id !== askingActionId;
        return <li key={action.id} className={quiet ? 'browser-step browser-step-muted' : 'browser-step'}>
          <Icon size={14} aria-hidden="true" />
          <span className="browser-step-text">{stepLabel(action)}{meta.length > 0 && <span className="muted browser-step-meta">{meta.join(' · ')}</span>}</span>
          <time dateTime={action.at}>{new Date(action.at).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' })}</time>
          {action.screenshotId && <Button size="icon" aria-label={t('Xem ảnh cửa sổ')} title={t('Xem ảnh cửa sổ')} onClick={() => openShot(action)}><Image size={14} /></Button>}
        </li>;
      })}
    </ol>
    {shown && <Drawer open onClose={() => setShown(undefined)} title={shown.label}>
      <img className="browser-screenshot" src={shown.url} alt={t('Ảnh cửa sổ: {0}', [shown.label])} />
    </Drawer>}
  </section>;
}

const kindIcons: Record<DesktopActKind, LucideIcon> = {
  invoke: MousePointerClick, set_value: TextCursorInput, toggle: ToggleRight, expand: ChevronsUpDown, collapse: ChevronsUpDown, select: ListChecks, scroll_into_view: MoveVertical,
};

/** "Researcher wants to press “Save” in “Untitled - Notepad”." */
function question(approval: DesktopApprovalView): string {
  const { workerName, element, window } = approval;
  if (approval.kind === 'set_value') return t('{0} muốn nhập vào “{1}” trong “{2}”.', [workerName, element, window]);
  if (approval.kind === 'toggle') return t('{0} muốn bật/tắt “{1}” trong “{2}”.', [workerName, element, window]);
  if (approval.kind === 'select') return t('{0} muốn chọn “{1}” trong “{2}”.', [workerName, element, window]);
  return t('{0} muốn bấm “{1}” trong “{2}”.', [workerName, element, window]);
}

function useApprovalPicture(taskId: string, screenshotId: string | undefined) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!screenshotId) return;
    let live = true;
    let created: string | undefined;
    void orglet.call('desktopScreenshot', { taskId, id: screenshotId }).then(shot => {
      if (!live) return;
      created = URL.createObjectURL(new Blob([shot.bytes as BlobPart], { type: shot.mimeType }));
      setUrl(created);
    }).catch(() => undefined);
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [taskId, screenshotId]);
  return url;
}

/**
 * The card a solo chat shows when its orglet wants to take a step in a desktop app that could send, delete, save over a
 * file, close the app or confirm a dialog: who wants to do what to which element in which window, why Orglet asks, the
 * window with the element outlined, and two answers. There is no "always".
 */
export function DesktopApprovalCard({ taskId, approval, busy, onAnswer }: { taskId: string; approval: DesktopApprovalView; busy: boolean; onAnswer: (answer: 'allow' | 'decline') => void }) {
  const picture = useApprovalPicture(taskId, approval.screenshotId);
  const [enlarged, setEnlarged] = useState(false);
  const Icon = kindIcons[approval.kind] ?? ShieldAlert;
  return <div className="browser-approval" role="group" aria-label={t('Cho phép bước trong ứng dụng')}>
    <p role="status" className="mcp-approval-question"><Icon size={16} aria-hidden="true" /><span>{question(approval)}</span></p>
    {approval.text !== undefined && <pre className="mcp-arguments" aria-label={t('Nội dung sẽ nhập')}>{approval.text || t('(để trống)')}</pre>}
    {picture && <button type="button" className="browser-approval-shot" aria-label={t('Xem ảnh cửa sổ lớn hơn')} onClick={() => setEnlarged(true)}>
      <img src={picture} alt={t('Cửa sổ {0}, phần tử được hỏi có viền đỏ', [approval.window])} />
    </button>}
    {approval.reasons.length > 0 && <p className="muted browser-approval-reasons">{t('Orglet hỏi vì: {0}', [approval.reasons.map(reason => tMessage(reason)).join(' · ')])}</p>}
    <div className="actions">
      <Button variant="primary" disabled={busy} onClick={() => onAnswer('allow')}><Check size={16} />{t('Cho phép một lần')}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => onAnswer('decline')}><X size={16} />{t('Không cho phép')}</Button>
    </div>
    {enlarged && picture && <Drawer open onClose={() => setEnlarged(false)} title={approval.window}>
      <img className="browser-screenshot" src={picture} alt={t('Cửa sổ {0}, phần tử được hỏi có viền đỏ', [approval.window])} />
    </Drawer>}
  </div>;
}
