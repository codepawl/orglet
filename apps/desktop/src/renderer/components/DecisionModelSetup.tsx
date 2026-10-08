import { useEffect, useState } from 'react';
import { FlaskConical, PowerOff } from 'lucide-react';
import { Input, Skeleton } from '@codepawlhq/orglet-ui';
import { CredentialProvider, type Args, type Connections } from '../../shared/contracts';
import { decisionModelHint, type DecisionModelSettingView } from '../../shared/decisions';
import { isHarness } from '../../shared/harness';
import type { CustomConnection } from '../../shared/custom-connections';
import { Button } from './ui';
import { Select, type SelectOption } from './Select';
import { StatusMark } from './StatusMark';
import { readiness } from './providers';
import { workerProviderOptions } from './WorkerDialog';
import { toast } from './toast';
import { publishDecisionModelSetting, useDecisionModelSetting } from '../decisionModelSetting';
import { t, tMessage } from '../i18n';
import { orglet } from '../api';

const OFF = 'off';

type Outcome = { tone: 'success' | 'error'; text: string };

/** The connections a chat offers that are APIs: a harness CLI is not one, and sample replies are no connection. */
export function decisionModelConnectionOptions(connections: Connections, customConnections: readonly CustomConnection[]): SelectOption[] {
  const offered = workerProviderOptions(readiness(connections, [], customConnections), [], customConnections)
    .filter(option => option.value !== 'demo' && !isHarness(option.value));
  return [{ value: OFF, label: t('Tắt'), icon: <PowerOff size={16} /> }, ...offered];
}

function costNote(connection: string): string {
  if (connection === OFF) return t('Không có kết nối nào: các việc nhỏ này chạy theo quy tắc như trước.');
  if (connection === 'openai') return t('Câu hỏi và ngữ cảnh ngắn gửi tới OpenAI (Decisions API beta), $0,10 mỗi triệu token đầu vào.');
  return t('Câu hỏi và ngữ cảnh ngắn gửi tới nhà cung cấp này, tính phí theo bảng giá của họ.');
}

/**
 * Settings → Chat → the decision model (COD-303): which of the chat's own connections answers the decision model's small questions, or none.
 * The model is a field prefilled for the connection; Test sends one sample question and shows the answer and how long
 * it took. The note under Model says where the text goes, because that is the choice being made.
 */
export function DecisionModelSetup({ connections, customConnections }: { connections: Connections; customConnections: readonly CustomConnection[] }) {
  const view = useDecisionModelSetting();
  const [connection, setConnection] = useState(OFF);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  // The setting in force fills the fields; a draft the person is still typing (a custom connection with no model yet) is kept.
  useEffect(() => {
    if (!view) return;
    setConnection(view.setting === OFF ? OFF : view.setting.connection);
    setModel(view.setting === OFF ? '' : view.setting.model);
  }, [view]);
  useEffect(() => setOutcome(undefined), [connection, model]);

  const save = async (next: Args<'saveDecisionModelSetting'>) => {
    setBusy(true);
    try {
      const saved: DecisionModelSettingView = await orglet.call('saveDecisionModelSetting', next);
      publishDecisionModelSetting(saved);
    } catch (error) {
      toast(tMessage((error as Error).message), 'error', t('Model quyết định'));
    } finally {
      setBusy(false);
    }
  };
  /** Saves the connection and model typed so far; a model still empty, or the setting already in force, saves nothing. */
  const commit = async (nextConnection: string, nextModel: string, force = false) => {
    if (nextConnection === OFF) return save(OFF);
    const trimmed = nextModel.trim();
    if (!trimmed) return;
    const inForce = view?.setting;
    const unchanged = inForce !== undefined && inForce !== OFF && inForce.connection === nextConnection && inForce.model === trimmed;
    if (unchanged && !force) return;
    await save({ connection: CredentialProvider.parse(nextConnection), model: trimmed });
  };
  const pick = (next: string) => {
    const nextModel = next === OFF ? '' : decisionModelHint(next);
    setConnection(next);
    setModel(nextModel);
    void commit(next, nextModel, true);
  };
  const test = async () => {
    setOutcome(undefined);
    setTesting(true);
    try {
      await commit(connection, model);
      const result = await orglet.call('testDecisionModel', {});
      setOutcome({ tone: 'success', text: t('Model quyết định chọn “{0}” ({1}%) sau {2} ms.', [result.choice, Math.round(result.probability * 100), result.milliseconds]) });
    } catch (error) {
      setOutcome({ tone: 'error', text: tMessage((error as Error).message) });
    } finally {
      setTesting(false);
    }
  };

  const titleId = 'decision-model-setup-title';
  const active = connection !== OFF;
  return <section className="decision-model-setup" aria-labelledby={titleId}>
    <div className="setting-row">
      <div className="setting-text">
        <span id={titleId} className="setting-title">{t('Model quyết định')}</span>
        <span className="setting-description">{t('Trả lời nhanh các câu hỏi nhỏ ở nền: ai trả lời trong kênh, ghi chú nào hợp, một bước có vẻ rủi ro không.')}</span>
      </div>
      <div className="setting-control">
        {view ? <Select ariaLabel={t('Kết nối của model quyết định')} className="setting-select" value={connection} disabled={busy} showDetail={false}
          onChange={pick} options={decisionModelConnectionOptions(connections, customConnections)} menuMinWidth={240} /> : <Skeleton width={210} height={34} />}
      </div>
    </div>
    {active && <div className="setting-row">
      <div className="setting-text">
        <label htmlFor="decision-model-id" className="setting-title">{t('Model')}</label>
        <span className="setting-description">{costNote(connection)}</span>
      </div>
      <form className="setting-control" onSubmit={event => { event.preventDefault(); void commit(connection, model); }}>
        <Input id="decision-model-id" className="decision-model-input" value={model} maxLength={200} disabled={busy} spellCheck={false} autoComplete="off"
          placeholder={t('ID model')} onChange={event => setModel(event.target.value)} onBlur={() => void commit(connection, model)} />
      </form>
    </div>}
    {active && <div className="setting-row">
      <div className="setting-text">
        <span className="setting-title">{t('Thử model quyết định')}</span>
        <span className={`setting-description web-search-outcome${outcome ? ` ${outcome.tone}` : ''}`} aria-live="polite" data-align-ignore="family-lead">
          {outcome && !testing && <StatusMark variant="filled" tone={outcome.tone} label={outcome.tone === 'success' ? t('Trả lời được') : t('Lỗi')} decorative />}
          <span>{testing ? t('Đang hỏi…') : outcome ? outcome.text : t('Gửi một câu hỏi mẫu tới kết nối này và hiện câu trả lời.')}</span>
        </span>
      </div>
      <div className="setting-control">
        <Button variant="outline" disabled={busy || testing || !model.trim()} onClick={() => void test()}><FlaskConical size={13} />{t('Chạy thử')}</Button>
      </div>
    </div>}
  </section>;
}
