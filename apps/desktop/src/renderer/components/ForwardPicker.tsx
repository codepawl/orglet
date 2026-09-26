import * as Dialog from '@radix-ui/react-dialog';
import { Checkbox, DialogOverlay, Input, Textarea } from '@codepawl/orglet-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Forward, Search, X } from 'lucide-react';
import { Button } from './ui';
import { Avatar, RosterAvatars } from './Avatar';
import { relativeDay } from './SearchDialog';
import { filterOptions, type SendToOption } from '../sendTo';
import { forwardPreview, type ForwardOption, type ForwardRequest } from '../forward';
import { FORWARD_NOTE_CHARS, MAX_FORWARD_TARGETS } from '../../shared/forward';
import { t } from '../i18n';

const GROUP_TITLES: Record<SendToOption['group'], () => string> = {
  recent: () => t('Gần đây'),
  orglets: () => t('Tí'),
  crews: () => t('Hội'),
};

function OptionFaces({ option }: { option: SendToOption }) {
  if (option.faces.length === 1 && option.group === 'orglets') {
    const worker = option.faces[0];
    return <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="sm" />;
  }
  return <RosterAvatars workers={option.faces.slice(0, 2)} size="sm" max={2} />;
}

export type ForwardChoice = { targets: ForwardOption[]; note: string; carrySourceIds: string[] };

/**
 * Forward a message (COD-257), the way Messenger, Discord or Slack do it: the message on top, a search over recent
 * chats, orglets and crews, several of them ticked at once (up to five), the files it had to send along if wanted, an
 * optional note, and one Send. Built on the Send to picker's list and look; it only draws and hands the choice back.
 */
export function ForwardPicker({ request, options, sending, onSend, onClose }: {
  request?: ForwardRequest;
  options: readonly ForwardOption[];
  sending: boolean;
  onSend: (choice: ForwardChoice) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [carried, setCarried] = useState<string[]>([]);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    setQuery('');
    setPicked([]);
    setNote('');
    setCarried([]);
  }, [request?.messageId]);
  const shown = useMemo(() => filterOptions(options, query) as ForwardOption[], [options, query]);
  const full = picked.length >= MAX_FORWARD_TARGETS;
  const pickedOptions = picked.flatMap(chatKey => options.find(option => option.chatKey === chatKey) ?? []);
  // A side thread only reads files its main chat has (COD-247), and a file sent along would be a new one.
  const toSideThread = pickedOptions.some(option => option.sideThread);
  const toggle = (option: ForwardOption) => {
    if (option.unavailable) return;
    setPicked(current => current.includes(option.chatKey)
      ? current.filter(chatKey => chatKey !== option.chatKey)
      : current.length >= MAX_FORWARD_TARGETS ? current : [...current, option.chatKey]);
  };
  const toggleFile = (sourceId: string) => setCarried(current => current.includes(sourceId) ? current.filter(item => item !== sourceId) : [...current, sourceId]);
  const send = () => {
    if (!pickedOptions.length || sending) return;
    onSend({ targets: pickedOptions, note: note.trim(), carrySourceIds: toSideThread ? [] : carried });
  };
  const sendLabel = picked.length > 1 ? t('Gửi ({0})', [picked.length]) : t('Gửi');

  return <Dialog.Root open={Boolean(request)} onOpenChange={value => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <DialogOverlay />
      <Dialog.Content className="send-to-dialog forward-dialog">
        <div className="send-to-head">
          <div className="send-to-heading">
            <Dialog.Title className="send-to-title">{t('Chuyển tiếp tin nhắn')}</Dialog.Title>
            <Dialog.Description className="send-to-files">{request ? forwardPreview(request) : ''}</Dialog.Description>
          </div>
          <Dialog.Close asChild><Button size="icon" aria-label={t('Đóng')}><X size={18} /></Button></Dialog.Close>
        </div>
        <div className="send-to-search">
          <Search size={16} aria-hidden="true" />
          <Input autoFocus aria-label={t('Tìm Tí, hội hoặc cuộc trò chuyện')} placeholder={t('Tìm Tí, hội hoặc cuộc trò chuyện')} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              list.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
            }
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              const first = shown.find(option => !option.unavailable);
              if (first) toggle(first);
            }
          }} />
        </div>
        <ul className="send-to-options forward-options" aria-label={t('Nơi nhận')} ref={list}>
          {shown.map((option, index) => {
            const startsGroup = index === 0 || shown[index - 1].group !== option.group;
            const checked = picked.includes(option.chatKey);
            return <li key={option.key} className={startsGroup ? 'send-to-group-start' : undefined}>
              {startsGroup && <span className="send-to-group" aria-hidden="true">{GROUP_TITLES[option.group]()}</span>}
              <Checkbox className={option.sideThread ? 'forward-option side-thread' : 'forward-option'} checked={checked} disabled={Boolean(option.unavailable) || (full && !checked)} onChange={() => toggle(option)}>
                <span className="forward-option-row">
                  <OptionFaces option={option} />
                  <span className="send-to-option-text">
                    <span className="send-to-option-name">{option.name}</span>
                    {option.detail && <span className="send-to-option-detail">{option.detail}</span>}
                  </span>
                  {option.unavailable
                    ? <span className="send-to-option-time">{option.unavailable}</span>
                    : option.when && <time className="send-to-option-time" dateTime={option.when}>{relativeDay(option.when)}</time>}
                </span>
              </Checkbox>
            </li>;
          })}
        </ul>
        {!shown.length && <p className="send-to-empty">{options.length ? t('Không tìm thấy Tí hay hội nào.') : t('Chưa có Tí nào.')}</p>}
        <div className="forward-foot">
          {request && request.files.length > 0 && <div className="forward-files" role="group" aria-label={t('Tệp trong tin này')}>
            {request.files.map(file => <Checkbox key={file.id} checked={!toSideThread && carried.includes(file.id)} disabled={toSideThread} onChange={() => toggleFile(file.id)}
              description={toSideThread ? t('Chat phụ chỉ dùng tệp của chat chính.') : t('Chat nhận sẽ đọc được tệp này. Không chọn thì chỉ gửi tên tệp.')}>
              {t('Gửi kèm {0}', [file.name])}
            </Checkbox>)}
          </div>}
          <Textarea className="forward-note" rows={2} maxLength={FORWARD_NOTE_CHARS} aria-label={t('Lời nhắn')} placeholder={t('Thêm lời nhắn (không bắt buộc)')} value={note}
            onChange={event => setNote(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); } }} />
          <div className="forward-actions">
            <p className="forward-hint">{full ? t('Tối đa {0} chat mỗi lần.', [MAX_FORWARD_TARGETS]) : t('Mỗi chat nhận như tin bạn gửi, và Tí ở đó sẽ trả lời.')}</p>
            <Button variant="primary" disabled={!picked.length || sending} onClick={send}><Forward size={16} />{sendLabel}</Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
