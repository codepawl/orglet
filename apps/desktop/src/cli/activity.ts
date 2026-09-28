import { translate } from '../shared/i18n';
import { en } from '../shared/locales/en';
import type { CliActivity } from './protocol';
import { displayWidth, ERROR_COLOR, muted, paint, stripAnsi, truncate, wrapSegments, type ColorMode } from './terminal';

const TOOL_LABELS: Readonly<Record<string, string>> = {
  workspace_read: 'Đọc file', workspace_list: 'Liệt kê file', workspace_search: 'Tìm trong file',
  workspace_write: 'Ghi file', workspace_edit: 'Sửa file', workspace_start_process: 'Chạy câu lệnh',
  workspace_process_output: 'Đọc đầu ra lệnh', web_search: 'Tìm kiếm web', web_read_url: 'Đọc một trang web',
  read: 'Đọc file', search: 'Tìm', list: 'Liệt kê file', other: 'Sử dụng công cụ',
};

/** A moving emphasis in text, with the terminal's own foreground at the centre. No blinking or cursor movement. */
export function shimmer(text: string, mode: ColorMode, milliseconds: number, reducedMotion: boolean): string {
  if (mode === 'none' || reducedMotion) return muted(text, mode);
  const width = displayWidth(text);
  const centre = ((milliseconds % 2400) / 2400) * (width + 8) - 4;
  let column = 0;
  return [...text].map(character => {
    const distance = Math.abs(column - centre);
    column += displayWidth(character);
    if (distance < 2) return paint(character, { bold: true }, mode);
    if (distance < 4) return paint(character, { foreground: '#b1b6be' }, mode);
    return muted(character, mode);
  }).join('');
}

function stepLabel(step: CliActivity): string {
  if (step.kind !== 'model') return TOOL_LABELS[step.label] ? translate(en, TOOL_LABELS[step.label]) : step.label.replaceAll('_', ' ');
  if (step.state === 'completed') return translate(en, 'Model đã trả kết quả');
  if (step.state === 'failed') return translate(en, 'Lượt gọi model thất bại');
  if (step.state === 'stopped') return translate(en, 'Lượt gọi model đã dừng');
  if (step.state !== 'running') return translate(en, 'Lượt gọi model');
  if (step.label === 'writing') return translate(en, 'Đang viết câu trả lời…');
  return step.label === 'thinking' ? translate(en, 'Đang suy nghĩ…') : translate(en, 'Model đang làm việc…');
}

export function activityLines(steps: readonly CliActivity[], options: {
  width: number; mode: ColorMode; expanded: boolean; milliseconds: number; reducedMotion: boolean; following?: boolean;
}): string[] {
  const firstTime = Date.parse(steps[0]?.startedAt ?? '');
  const showAuthor = new Set(steps.map(step => step.name)).size > 1;
  return steps.flatMap(rawStep => {
    const safeText = (text: string) => stripAnsi(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, '');
    const step = { ...rawStep, name: safeText(rawStep.name), label: safeText(rawStep.label),
      ...(rawStep.detail ? { detail: safeText(rawStep.detail) } : {}),
    };
    const seconds = Math.max(0, Math.floor((Date.parse(step.startedAt) - firstTime) / 1000));
    const time = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    const active = step.state === 'running' && options.following !== false;
    const symbol = active ? '●' : step.state === 'running' ? '○' : ['failed', 'unknown', 'stopped'].includes(step.state) ? '!' : options.expanded ? '▾' : '▸';
    const label = stepLabel(step);
    const suffix = step.kind === 'tool' && step.detail ? ` · ${step.detail.replace(/\s+/gu, ' ')}` : '';
    const state = step.state === 'running' && !active ? translate(en, ' · tiếp tục trong app') : step.state === 'failed' && step.kind === 'tool' ? translate(en, ' · thất bại') : step.state === 'unknown' ? translate(en, ' · chưa rõ kết quả')
      : step.state === 'waiting' ? translate(en, ' · đang chờ') : step.state === 'stopped' && step.kind !== 'model' ? translate(en, ' · đã dừng') : '';
    const author = showAuthor ? `${truncate(step.name, Math.max(1, Math.min(14, Math.floor(options.width / 4))))} · ` : '';
    const prefix = `${time} ${symbol} ${author}`;
    const text = truncate(`${label}${suffix}${state}`, Math.max(1, options.width - displayWidth(prefix)));
    const styled = active ? shimmer(text, options.mode, options.milliseconds, options.reducedMotion)
      : paint(text, ['failed', 'unknown'].includes(step.state) ? { foreground: ERROR_COLOR } : {}, options.mode);
    const lines = [truncate(`${muted(prefix, options.mode)}${styled}`, options.width)];
    if (options.expanded && step.state !== 'running') {
      const elapsed = Math.max(0, (Date.parse(step.updatedAt) - Date.parse(step.startedAt)) / 1000);
      lines.push(...wrapSegments([{ text: `${step.state} · ${elapsed.toFixed(1)}s`, style: { foreground: '#8b919a' } }],
        { width: options.width, mode: options.mode, firstPrefix: '  ', restPrefix: '  ' }));
      if (step.detail) {
        for (const paragraph of step.detail.split('\n')) lines.push(...wrapSegments([{ text: paragraph }],
          { width: options.width, mode: options.mode, firstPrefix: '  ', restPrefix: '  ' }));
      }
    }
    return lines;
  });
}
