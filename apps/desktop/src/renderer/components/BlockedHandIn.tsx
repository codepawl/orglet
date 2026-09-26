import { useEffect, useState } from 'react';
import { CircleAlert, SquareTerminal } from 'lucide-react';
import { commandLine, type BlockingCommand } from '../../shared/blocked-hand-in';
import type { RecoveryOutput } from '../../shared/workspace-recovery';
import { SourceViewer } from './SourceViewer';
import { CodePreview } from './CodePreview';
import type { InfoTipRow } from './InfoTip';
import { SkeletonGroup, SkeletonText } from '@codepawl/orglet-ui';
import { t, tMessage } from '../i18n';
import { orglet } from '../api';

/*
 * A hand-in a failed command refused (COD-270). The turn names each command that failed after the orglet's last edit
 * in one quiet line under its answer, the way the changed-files line sits under it, and the line opens the last lines
 * of that command's output in the source viewer's shell. Deciding what to do sits in the turn's actions, not here.
 */

/** Stands in for the command while the sentence is translated, so the command can be set as code inside it. */
const COMMAND_SLOT = '\u0000';
/** How much of a stream the viewer shows: enough to read a failure, never a whole log. */
const TAIL_LINES = 80;

/** Why the changes did not reach the folder, with `name` where the command goes. */
function blockedSentence(command: BlockingCommand, name: string): string {
  if (command.state === 'exited') return t('{0} thoát với mã {1}, nên thay đổi chưa được áp dụng', [name, command.exitCode]);
  if (command.state === 'timeout') return t('{0} hết thời gian, nên thay đổi chưa được áp dụng', [name]);
  if (command.state === 'cancelled') return t('{0} bị dừng trước khi xong, nên thay đổi chưa được áp dụng', [name]);
  if (command.state === 'output_limit') return t('{0} vượt giới hạn đầu ra, nên thay đổi chưa được áp dụng', [name]);
  return t('{0} chưa rõ kết quả, nên thay đổi chưa được áp dụng', [name]);
}

/** How the command ended, in the viewer's meta line and its info. */
function resultLabel(command: BlockingCommand): string {
  if (command.state === 'exited') return t('Thoát với mã {0}', [command.exitCode]);
  if (command.state === 'timeout') return t('Hết thời gian');
  if (command.state === 'cancelled') return t('Đã hủy');
  if (command.state === 'output_limit') return t('Vượt giới hạn đầu ra');
  return t('Chưa rõ kết quả');
}

/** What "Nhờ sửa" puts in the composer: the failed commands and what to do. It is a draft; nothing is sent. */
export function askToFixText(commands: readonly BlockingCommand[]): string {
  const reasons = commands.map(command => `${blockedSentence(command, `\`${commandLine(command)}\``)}.`);
  return [...reasons, t('Xem đầu ra của lệnh, sửa để lệnh chạy qua rồi làm lại.')].join(' ');
}

/**
 * "`npm test` thoát với mã 1, nên thay đổi chưa được áp dụng · Xem đầu ra": one line per blocking command, which
 * opens its output. In a crew's card it carries the member's name, since each member hands in its own copy.
 */
export function BlockedCommandLine({ command, workerName, onOpen }: { command: BlockingCommand; workerName?: string; onOpen: () => void }) {
  const line = commandLine(command, 120);
  const parts = blockedSentence(command, COMMAND_SLOT).split(COMMAND_SLOT);
  // A translation that lost the slot still reads right, with the command as plain text.
  const sentence = parts.length === 2 ? <>{parts[0]}<code>{line}</code>{parts[1]}</> : blockedSentence(command, line);
  return <button type="button" className="activity-summary blocked-command" aria-haspopup="dialog" onClick={onOpen}>
    <CircleAlert size={14} aria-hidden="true" />
    <span>
      {workerName ? `${workerName}: ` : ''}{sentence}
      <span className="blocked-command-open"> · {t('Xem đầu ra')}</span>
    </span>
  </button>;
}

type Tail = { text: string; lines: number; cut: boolean };

/** Reads a stream page by page and keeps its end: the last page and the one before it cover a line cut at a page edge. */
async function readTail(read: (offset: number) => Promise<RecoveryOutput>): Promise<Tail> {
  let offset = 0;
  let previous = '';
  let current = '';
  for (;;) {
    const page = await read(offset);
    previous = current;
    current = page.content;
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  const lines = `${previous}${current}`.replace(/\r?\n$/, '').split(/\r?\n/);
  const kept = lines.slice(-TAIL_LINES);
  const text = kept.join('\n');
  return { text, lines: kept.length, cut: offset > 0 || lines.length > TAIL_LINES };
}

/** The last lines of a blocking command's output, stdout then stderr, in the source viewer's shell. Read-only. */
export function CommandOutputDialog({ taskId, command, onClose }: { taskId: string; command: BlockingCommand; onClose: () => void }) {
  const [tails, setTails] = useState<{ stdout: Tail; stderr: Tail }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    const read = (stream: 'stdout' | 'stderr') => readTail(offset =>
      orglet.call('recoveryProcessOutput', { taskId, processId: command.processId, stream, offset }));
    Promise.all([read('stdout'), read('stderr')])
      .then(([stdout, stderr]) => { if (active) setTails({ stdout, stderr }); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { active = false; };
  }, [taskId, command.processId]);
  const info: InfoTipRow[] = [
    { label: t('Lệnh'), value: commandLine(command, 1000), mono: true },
    { label: t('Kết quả'), value: resultLabel(command) },
    { label: t('Mã tiến trình'), value: command.processId, mono: true, onCopy: () => orglet.copyText(command.processId) },
  ];
  const streams = tails ? (['stdout', 'stderr'] as const).filter(stream => tails[stream].text.trim()) : [];
  return <SourceViewer open onClose={onClose} name={commandLine(command, 120)} meta={resultLabel(command)} icon={SquareTerminal}
    info={info} infoLabel={t('Thông tin về lệnh này')} menuLabel={t('Tùy chọn')}>
    {!tails && !error && <SkeletonGroup label={t('Đang mở…')}><SkeletonText lines={6} /></SkeletonGroup>}
    {error && <p className="preview-state">{tMessage(error)}</p>}
    {tails && streams.length === 0 && <p className="preview-state">{t('Lệnh này không in gì ra.')}</p>}
    {tails && streams.length > 0 && <div className="command-output">
      {streams.map(stream => <section key={stream} className="command-output-stream" aria-label={stream}>
        <h3 className="diff-file-heading"><span className="diff-file-path">{stream}</span></h3>
        {tails[stream].cut && <p className="preview-note">{t('Đang hiện {0} dòng cuối.', [tails[stream].lines])}</p>}
        <CodePreview text={tails[stream].text} language="text" />
      </section>)}
    </div>}
  </SourceViewer>;
}
