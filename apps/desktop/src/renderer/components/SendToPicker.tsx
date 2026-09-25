import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { Button } from './ui';
import { Avatar, RosterAvatars } from './Avatar';
import { relativeDay } from './SearchDialog';
import { filterOptions, type SendToOption } from '../sendTo';
import { t } from '../i18n';

const GROUP_TITLES: Record<SendToOption['group'], () => string> = {
  recent: () => t('Gần đây'),
  orglets: () => t('Tí'),
  crews: () => t('Hội'),
};

function OptionFaces({ option }: { option: SendToOption }) {
  if (option.faces.length === 1 && option.group === 'orglets') {
    const worker = option.faces[0];
    return <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="sm" />;
  }
  // Two faces and no "+N": the row's detail already names every member, and the slot stays two faces wide.
  return <RosterAvatars workers={option.faces.slice(0, 2)} size="sm" max={2} />;
}

/** The names of the files, as one quiet line: the first few, then how many more. */
function fileLine(names: readonly string[], count: number): string {
  const shown = names.slice(0, 3).join(', ');
  const rest = count - Math.min(names.length, 3);
  return rest > 0 ? t('{0} và {1} tệp khác', [shown, rest]) : shown;
}

/**
 * Where files sent from Explorer go (COD-246): a palette of the recent chats, the orglets and the crews, each with its
 * faces. Choosing one hands the choice back; the caller attaches the files to that chat's message box. Nothing is
 * sent from here.
 */
export function SendToPicker({ open, count, names, options, onChoose, onClose }: {
  open: boolean;
  count: number;
  names: readonly string[];
  options: readonly SendToOption[];
  onChoose: (option: SendToOption) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => filterOptions(options, query), [options, query]);
  useEffect(() => {
    if (open) return;
    setQuery('');
    setActive(0);
  }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const choose = (index: number) => {
    const option = shown[index];
    if (option) onChoose(option);
  };
  const title = count === 1 ? t('Gửi 1 tệp tới…') : t('Gửi {0} tệp tới…', [count]);
  const activeOption = shown[active];

  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay" />
      <Dialog.Content className="send-to-dialog">
        <div className="send-to-head">
          <div className="send-to-heading">
            <Dialog.Title className="send-to-title">{title}</Dialog.Title>
            <Dialog.Description className="send-to-files">{fileLine(names, count)}</Dialog.Description>
          </div>
          <Dialog.Close asChild><Button size="icon" aria-label={t('Đóng')}><X size={18} /></Button></Dialog.Close>
        </div>
        <div className="send-to-search">
          <Search size={16} aria-hidden="true" />
          <input autoFocus role="combobox" aria-expanded={shown.length > 0} aria-controls="send-to-options" aria-activedescendant={activeOption ? `send-to-${activeOption.key}` : undefined} aria-autocomplete="list" aria-label={t('Tìm Tí, hội hoặc cuộc trò chuyện')} placeholder={t('Tìm Tí, hội hoặc cuộc trò chuyện')} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, shown.length - 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); choose(active); }
          }} />
        </div>
        <ul className="send-to-options" id="send-to-options" role="listbox" aria-label={t('Nơi nhận')} ref={list}>
          {shown.map((option, index) => {
            const startsGroup = index === 0 || shown[index - 1].group !== option.group;
            const selected = index === active;
            return <li key={option.key} role="presentation" className={startsGroup ? 'send-to-group-start' : undefined}>
              {startsGroup && <span className="send-to-group" aria-hidden="true">{GROUP_TITLES[option.group]()}</span>}
              <div id={`send-to-${option.key}`} data-index={index} role="option" aria-selected={selected} className="send-to-option" onMouseMove={() => setActive(index)} onClick={() => choose(index)}>
                <OptionFaces option={option} />
                <span className="send-to-option-text">
                  <span className="send-to-option-name">{option.name}</span>
                  {option.detail && <span className="send-to-option-detail">{option.detail}</span>}
                </span>
                {selected
                  ? <CornerDownLeft size={16} className="send-to-option-enter" aria-hidden="true" />
                  : option.when && <time className="send-to-option-time" dateTime={option.when}>{relativeDay(option.when)}</time>}
              </div>
            </li>;
          })}
        </ul>
        {!shown.length && <p className="send-to-empty">{options.length ? t('Không tìm thấy Tí hay hội nào.') : t('Chưa có Tí nào.')}</p>}
        <p className="send-to-note">{t('Tệp sẽ nằm trong ô soạn tin. Chưa gửi gì cho tới khi bạn bấm Gửi.')}</p>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
