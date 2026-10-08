import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Clock, FlaskConical, Plus, Trash2 } from 'lucide-react';
import { Input, Skeleton, Tooltip } from '@codepawlhq/orglet-ui';
import { type Args, type Connections } from '../../shared/contracts';
import { CODEX_DECISION_CONNECTION, DECISION_MODEL_MAX_ENTRIES, decisionModelHint, isHarnessDecisionConnection, type DecisionModelConnection } from '../../shared/decisions';
import { isHarness, type HarnessInfo } from '../../shared/harness';
import type { CustomConnection } from '../../shared/custom-connections';
import { Button } from './ui';
import { Select, type SelectOption } from './Select';
import { StatusMark } from './StatusMark';
import { readiness } from './providers';
import { workerProviderOptions } from './WorkerDialog';
import { toast } from './toast';
import { publishDecisionModelSetting, useDecisionModelSetting } from '../decisionModelSetting';
import { decisionBackendName } from '../decisionBackends';
import { t, tMessage } from '../i18n';
import { orglet } from '../api';

type Outcome = { tone: 'success' | 'error'; text: string };

/**
 * The backends a priority list offers: the chat's API connections, and the Codex CLI as "ChatGPT (Codex)" while it is
 * signed in (or when the list already holds it, so a row never loses its own choice). The other harnesses are not
 * offered, and sample replies are no connection.
 */
export function decisionModelConnectionOptions(connections: Connections, customConnections: readonly CustomConnection[], harnesses: HarnessInfo[] | undefined, keepCodex: boolean): SelectOption[] {
  const offered = workerProviderOptions(readiness(connections, harnesses, customConnections), harnesses ?? [], customConnections);
  const codexSignedIn = harnesses?.some(item => item.id === CODEX_DECISION_CONNECTION && item.auth === 'logged_in') ?? false;
  return offered
    .filter(option => option.value !== 'demo' && (!isHarness(option.value) || (option.value === CODEX_DECISION_CONNECTION && (codexSignedIn || keepCodex))))
    .map(option => option.value === CODEX_DECISION_CONNECTION ? { ...option, label: t('ChatGPT (Codex)') } : option);
}

/** A failed test's message: one line per backend tried, each reason translated on its own. */
function failureText(message: string): string {
  return message.split('\n').map(line => {
    const numbered = /^(\d+)\. (.*)$/s.exec(line);
    return numbered ? `${numbered[1]}. ${tMessage(numbered[2])}` : tMessage(line);
  }).join(' ');
}

/** What goes to each kind of backend, and what it costs: said once under the list, for the kinds the list holds. */
function costNote(rows: readonly DecisionModelConnection[]): string {
  if (!rows.length) return t('Chưa có lựa chọn nào: các việc nhỏ này chạy theo quy tắc như trước.');
  const notes: string[] = [];
  if (rows.some(row => row.connection === 'openai')) notes.push(t('Câu hỏi và ngữ cảnh ngắn gửi tới OpenAI (Decisions API beta), $0,10 mỗi triệu token đầu vào.'));
  if (rows.some(row => row.connection !== 'openai' && !isHarnessDecisionConnection(row.connection))) notes.push(t('Câu hỏi và ngữ cảnh ngắn gửi tới nhà cung cấp này, tính phí theo bảng giá của họ.'));
  if (rows.some(row => isHarnessDecisionConnection(row.connection))) notes.push(t('ChatGPT (Codex) chạy theo gói ChatGPT của bạn, không tính tiền, nhưng mất cỡ 10 giây nên chỉ làm việc ở nền như báo lịch hằng giờ.'));
  return notes.join(' ');
}

/**
 * Settings → Chat → the decision model (COD-303): an ordered list of up to three backends, each one of the chat's own
 * connections or the signed-in Codex, with its model. Every small question goes to the first row that can answer it;
 * a row is passed over when it is missing, fails, is late, or is a slow one and the question cannot wait. Nothing
 * outside the list ever answers, and an empty list is off. Test sends one sample question through the list and says
 * which row answered and how long it took.
 */
export function DecisionModelSetup({ connections, customConnections, harnesses }: { connections: Connections; customConnections: readonly CustomConnection[]; harnesses: HarnessInfo[] | undefined }) {
  const view = useDecisionModelSetting();
  const [rows, setRows] = useState<DecisionModelConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  // The list in force fills the rows; a draft the person is still typing (a custom connection with no model yet) is kept until it is complete.
  useEffect(() => {
    if (view) setRows(view.entries);
  }, [view]);
  useEffect(() => setOutcome(undefined), [rows]);

  const complete = (list: readonly DecisionModelConnection[]) => list.every(row => row.model.trim());
  const save = async (next: Args<'saveDecisionModelSetting'>) => {
    setBusy(true);
    try {
      publishDecisionModelSetting(await orglet.call('saveDecisionModelSetting', next));
    } catch (error) {
      toast(tMessage((error as Error).message), 'error', t('Model quyết định'));
      if (view) setRows(view.entries);
    } finally {
      setBusy(false);
    }
  };
  /** Shows the rows at once and saves them when each has a model and they differ from the list in force. */
  const commit = async (next: DecisionModelConnection[]) => {
    setRows(next);
    if (!complete(next)) return;
    const trimmed = next.map(row => ({ connection: row.connection, model: row.model.trim() }));
    if (JSON.stringify(trimmed) === JSON.stringify(view?.entries)) return;
    await save(trimmed as Args<'saveDecisionModelSetting'>);
  };
  const edit = (index: number, change: Partial<DecisionModelConnection>) => rows.map((row, at) => at === index ? { ...row, ...change } : row);
  const pick = (index: number, connection: string) => void commit(edit(index, { connection, model: decisionModelHint(connection) }));
  const move = (index: number, step: -1 | 1) => {
    const next = [...rows];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    void commit(next);
  };
  const remove = (index: number) => void commit(rows.filter((_, at) => at !== index));
  const options = (index: number) => decisionModelConnectionOptions(connections, customConnections, harnesses, rows[index] ? isHarnessDecisionConnection(rows[index].connection) : false);
  const add = () => {
    const used = new Set(rows.map(row => row.connection));
    const first = decisionModelConnectionOptions(connections, customConnections, harnesses, false).find(option => !used.has(option.value) && !option.dimmed && decisionModelHint(option.value))
      ?? decisionModelConnectionOptions(connections, customConnections, harnesses, false).find(option => !option.dimmed && decisionModelHint(option.value));
    const connection = first?.value ?? 'openai';
    void commit([...rows, { connection, model: decisionModelHint(connection) }]);
  };
  const test = async () => {
    setOutcome(undefined);
    setTesting(true);
    try {
      await commit(rows);
      const result = await orglet.call('testDecisionModel', {});
      const place = result.attempts.findIndex(attempt => attempt.outcome === 'answered') + 1;
      const passedOver = place - 1;
      const text = t('{0} trả lời “{1}” ({2}%) sau {3} ms.', [decisionBackendName(result.connection), result.choice, Math.round(result.probability * 100), result.milliseconds]);
      setOutcome({ tone: 'success', text: passedOver > 0 ? `${text} ${t('Đã bỏ qua {0} lựa chọn đứng trước.', [passedOver])}` : text });
    } catch (error) {
      setOutcome({ tone: 'error', text: failureText((error as Error).message) });
    } finally {
      setTesting(false);
    }
  };

  const titleId = 'decision-model-setup-title';
  return <section className="decision-model-setup" aria-labelledby={titleId}>
    <div className="setting-row">
      <div className="setting-text">
        <span id={titleId} className="setting-title">{t('Model quyết định')}</span>
        <span className="setting-description">{t('Trả lời nhanh các câu hỏi nhỏ ở nền: ai trả lời trong kênh, ghi chú nào hợp, một bước có vẻ rủi ro không. Thử từ trên xuống, lựa chọn đầu trả lời được là dừng.')}</span>
      </div>
      <div className="setting-control">
        <Button variant="outline" disabled={busy || !view || rows.length >= DECISION_MODEL_MAX_ENTRIES} onClick={add}><Plus size={13} />{t('Thêm lựa chọn')}</Button>
      </div>
    </div>
    {!view && <Skeleton width="100%" height={34} />}
    {rows.map((row, index) => {
      const harness = isHarnessDecisionConnection(row.connection);
      return <div key={index} className="setting-row decision-entry" role="group" aria-label={t('Lựa chọn {0}', [index + 1])}>
        <span className="decision-entry-rank" aria-hidden="true">{index + 1}</span>
        <div className="decision-entry-fields">
          <div className="decision-entry-inputs">
            <Select ariaLabel={t('Kết nối của lựa chọn {0}', [index + 1])} className="setting-select" value={row.connection} disabled={busy} showDetail={false}
              onChange={connection => pick(index, connection)} options={options(index)} menuMinWidth={240} />
            <form className="decision-entry-model" onSubmit={event => { event.preventDefault(); void commit(rows); }}>
              <Input className="decision-model-input" aria-label={t('Model của lựa chọn {0}', [index + 1])} value={row.model} maxLength={200} disabled={busy} spellCheck={false} autoComplete="off"
                placeholder={t('ID model')} onChange={event => setRows(edit(index, { model: event.target.value }))} onBlur={() => void commit(rows)} />
            </form>
          </div>
          {harness && <span className="decision-entry-note"><Clock size={12} aria-hidden="true" />{t('Chỉ chạy nền · chậm')}</span>}
        </div>
        <div className="setting-control">
          <Tooltip label={t('Đưa lên')}><Button variant="ghost" size="icon" aria-label={t('Đưa lựa chọn {0} lên', [index + 1])} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></Button></Tooltip>
          <Tooltip label={t('Đưa xuống')}><Button variant="ghost" size="icon" aria-label={t('Đưa lựa chọn {0} xuống', [index + 1])} disabled={busy || index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></Button></Tooltip>
          <Tooltip label={t('Bỏ lựa chọn')}><Button variant="ghost" size="icon" aria-label={t('Bỏ lựa chọn {0}', [index + 1])} disabled={busy} onClick={() => remove(index)}><Trash2 size={15} /></Button></Tooltip>
        </div>
      </div>;
    })}
    {view && <div className="setting-row decision-note"><span className="setting-description">{costNote(rows)}</span></div>}
    {rows.length > 0 && <div className="setting-row">
      <div className="setting-text">
        <span className="setting-title">{t('Thử model quyết định')}</span>
        <span className={`setting-description web-search-outcome${outcome ? ` ${outcome.tone}` : ''}`} aria-live="polite" data-align-ignore="family-lead">
          {outcome && !testing && <StatusMark variant="filled" tone={outcome.tone} label={outcome.tone === 'success' ? t('Trả lời được') : t('Lỗi')} decorative />}
          <span>{testing ? t('Đang hỏi…') : outcome ? outcome.text : t('Gửi một câu hỏi mẫu qua danh sách này và hiện lựa chọn nào trả lời.')}</span>
        </span>
      </div>
      <div className="setting-control">
        <Button variant="outline" disabled={busy || testing || !complete(rows)} onClick={() => void test()}><FlaskConical size={13} />{t('Chạy thử')}</Button>
      </div>
    </div>}
  </section>;
}
