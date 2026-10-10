import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { FieldError } from '@codepawlhq/orglet-ui';
import type { Worker } from '../../shared/contracts';
import { Button } from './ui';
import { Avatar } from './Avatar';
import { Composer, restoreUnsent } from './Composer';
import { Select } from './Select';
import { t, tMessage } from '../i18n';
import { initialScheduleAsker, rememberScheduleAsker, rememberedScheduleAsker } from '../scheduleAsker';

/**
 * Requests a person can start from when they would rather ask an orglet than fill the form (user, 2026-10-06). One
 * fills the box and never sends; the orglet answers with a schedule to apply (`propose_schedule`).
 */
const SCHEDULE_ASKS = () => [
  t('Mỗi sáng thứ Hai, tóm tắt việc tuần trước và việc cần làm tuần này.'),
  t('Mỗi ngày lúc 9 giờ, đọc tin mới về chủ đề tôi theo dõi và báo lại ba điều đáng chú ý.'),
  t('Mỗi chiều thứ Sáu, rà lại việc còn dở trong tuần và nhắc tôi.'),
];

/**
 * What a person writes to an orglet to get a schedule made (issue 555). Sending hands the words to that orglet's own
 * chat as an ordinary turn; there is no separate schedules session. `onSend` resolves to false when the words stayed
 * unsent on purpose, for example while the orglet's model is being connected, and the box keeps them.
 */
export function ScheduleAsk({ workers, starters, onSend }: { workers: readonly Worker[]; /** The ready-made requests, offered while there are no schedules yet. */ starters: boolean; onSend: (workerId: string, message: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [chosenId, setChosenId] = useState(() => initialScheduleAsker(workers.map(worker => worker.id), rememberedScheduleAsker()));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // The orglet picked may have been archived or deleted since; the box then aims at the first one again.
  const askedId = initialScheduleAsker(workers.map(worker => worker.id), chosenId);
  const asked = workers.find(worker => worker.id === askedId);
  if (!asked) return null;
  const choose = (workerId: string) => {
    setChosenId(workerId);
    rememberScheduleAsker(workerId);
  };
  const send = async () => {
    if (sending || !text.trim()) return;
    const sentText = text;
    setSending(true);
    setError('');
    setText('');
    try {
      const sent = await onSend(asked.id, sentText);
      if (!sent) setText(current => restoreUnsent(sentText, current));
    } catch (failure) {
      setText(current => restoreUnsent(sentText, current));
      setError(tMessage((failure as Error).message));
    } finally {
      setSending(false);
    }
  };
  const options = workers.map(worker => ({
    value: worker.id,
    label: worker.name,
    icon: <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs" />,
  }));
  return <div className="routine-ask">
    <Composer value={text} onChange={setText} onSubmit={() => void send()} label={t('Nhờ Tí lên lịch')} placeholder={t('Nhờ {0} lên lịch: việc gì, vào lúc nào…', [asked.name])}
      sendLabel={t('Gửi tin nhắn')} sendDisabled={sending} leading={null}
      trailing={workers.length > 1 ? <Select className="composer-to-select" ariaLabel={t('Tí nhận yêu cầu lên lịch')} value={asked.id} onChange={choose} showDetail={false} showIcon={false} menuMinWidth={260} options={options} /> : undefined} />
    {error && <FieldError>{error}</FieldError>}
    {starters && <ul className="suggestions routine-asks" aria-label={t('Gợi ý yêu cầu')}>
      {SCHEDULE_ASKS().map(request => <li key={request}>
        <Button type="button" onClick={() => setText(t('Lên lịch giúp tôi: {0}', [request]))}><CalendarClock size={16} aria-hidden="true" />{request}</Button>
      </li>)}
    </ul>}
  </div>;
}
