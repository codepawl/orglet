import * as Dialog from '@radix-ui/react-dialog';
import { DialogOverlay } from '@codepawlhq/orglet-ui';
import { Ban, Check, Square, SquareTerminal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ElevationScope, TerminalAccessState, TerminalJournalRow } from '../../shared/terminal-access';
import { orglet } from '../api';
import { t } from '../i18n';
import { RowMenu } from './RowMenu';
import { toast } from './toast';
import { Button } from './ui';

/**
 * A terminal asking to act for the person, and acting (docs/cli-held-actions-design.md). The pairing dialog draws the
 * code main made; the person reads it and types it at the terminal. The window never starts or extends an elevation:
 * it can only cancel a pairing and end an elevation, and it never receives the elevation key.
 */

const TICK_MILLISECONDS = 10_000;

/** State pushed by main, with the first read. */
export function useTerminalAccess(): TerminalAccessState {
  const [state, setState] = useState<TerminalAccessState>({});
  useEffect(() => {
    let live = true;
    orglet.terminalAccessState().then(first => { if (live) setState(first); }).catch(() => undefined);
    const stop = orglet.onTerminalAccess(next => { if (live) setState(next); });
    return () => { live = false; stop(); };
  }, []);
  return state;
}

/** Re-renders every ten seconds, so a time left read from a clock stays honest without a ticking display. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MILLISECONDS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** "1 phút 40 giây", rounded up to the ten seconds the text is updated at. */
export function timeLeftText(endsAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / TICK_MILLISECONDS) * 10);
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return t('Còn {0} giây', [seconds]);
  return seconds % 60 === 0 ? t('Còn {0} phút', [minutes]) : t('Còn {0} phút {1} giây', [minutes, seconds % 60]);
}

function scopeWords(scope: ElevationScope, operation: string | undefined): string {
  if (scope === 'one') return operation ?? t('Một thao tác duy nhất.');
  if (scope === 'setup') return t('Cấp quyền và lưu khóa bí mật trong phiên terminal này.');
  return t('Trả lời các thẻ đang chờ bạn duyệt (công cụ, thay đổi, đề xuất, ghi nhớ). Không cấp quyền mới và không lưu khóa bí mật.');
}

/** The code in two halves of four, easier to read aloud and to type. */
function codeInHalves(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}

export function TerminalPairingDialog({ state }: { state: TerminalAccessState }) {
  const pairing = state.pairing;
  const now = useNow(Boolean(pairing));
  return <Dialog.Root open={Boolean(pairing)} onOpenChange={open => { if (!open) void orglet.cancelTerminalPairing().catch(() => undefined); }}>
    <Dialog.Portal>
      <DialogOverlay />
      <Dialog.Content className="terminal-pairing-dialog" aria-describedby="terminal-pairing-scope">
        {pairing && <>
          <div className="terminal-pairing-head">
            <SquareTerminal size={22} aria-hidden="true" />
            <Dialog.Title className="terminal-pairing-title">{t('Một terminal đang xin làm thay bạn.')}</Dialog.Title>
          </div>
          <Dialog.Description id="terminal-pairing-scope" className="terminal-pairing-scope">{scopeWords(pairing.scope, pairing.operation)}</Dialog.Description>
          <p className="terminal-pairing-hint">{t('Nếu bạn không vừa chạy lệnh nào ở terminal, bấm Hủy.')}</p>
          <p className="terminal-pairing-code" aria-label={t('Mã để gõ ở terminal')}>{codeInHalves(pairing.code)}</p>
          <p className="terminal-pairing-time" role="status">{timeLeftText(pairing.expiresAt, now)}</p>
          <div className="actions">
            <Button variant="outline" onClick={() => void orglet.cancelTerminalPairing().catch(() => undefined)}>{t('Hủy')}</Button>
          </div>
        </>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** After three pairings that ended without a match, main holds pairing; the window says so once, with an error mark. */
export function TerminalAccessNotices({ state }: { state: TerminalAccessState }) {
  const holdUntil = state.hold?.until;
  useEffect(() => {
    if (holdUntil) toast(t('Terminal bị tạm khóa'), 'error', t('Nó xin ghép đôi nhiều lần mà không nhập đúng mã. Thử lại sau ít phút.'));
  }, [holdUntil]);
  return null;
}

/** The quiet mark in the user panel while an elevation is live; End now is in its menu. */
export function TerminalAccessMark({ state }: { state: TerminalAccessState }) {
  const elevation = state.elevation;
  const now = useNow(Boolean(elevation));
  if (!elevation) return null;
  const left = timeLeftText(elevation.endsAt, now).toLowerCase();
  return <RowMenu label={`${t('Terminal đang làm thay bạn')}, ${left}`} className="terminal-access-mark" icon={SquareTerminal} align="start"
    items={[{ label: `${t('Dừng ngay')} · ${left}`, icon: Square, onSelect: () => void orglet.endTerminalAccess().catch(() => undefined) }]} />;
}

function OutcomeMark({ outcome }: { outcome: TerminalJournalRow['outcome'] }) {
  if (outcome === 'done') return <Check size={16} className="terminal-journal-done" aria-label={t('Đã làm')} />;
  if (outcome === 'failed') return <X size={16} className="terminal-journal-failed" aria-label={t('Không làm được')} />;
  return <Ban size={16} className="terminal-journal-refused" aria-label={t('Bị từ chối')} />;
}

/** "What the terminal did": the journal main keeps, newest first. */
export function TerminalJournal() {
  const [rows, setRows] = useState<TerminalJournalRow[]>();
  const state = useTerminalAccess();
  useEffect(() => {
    let live = true;
    orglet.terminalJournal().then(next => { if (live) setRows(next); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
    // An elevation ending or starting is when the list may have grown.
  }, [state.elevation?.endsAt]);
  if (rows === undefined) return null;
  if (rows.length === 0) return <p className="setting-description terminal-journal-empty">{t('Terminal chưa làm gì thay bạn.')}</p>;
  return <ul className="terminal-journal" aria-label={t('Terminal đã làm')}>
    {rows.map(row => <li key={row.id} className="terminal-journal-row">
      <OutcomeMark outcome={row.outcome} />
      <span className="terminal-journal-text">
        <span className="terminal-journal-operation">{row.operation}</span>
        <span className="terminal-journal-detail">{[row.subject, new Date(row.at).toLocaleString()].filter(Boolean).join(' · ')}</span>
      </span>
    </li>)}
  </ul>;
}
