import { useEffect, useState } from 'react';
import { Hash, Info, LayoutGrid, Trash2, UserMinus } from 'lucide-react';
import { channelLabel } from '../../shared/channels';
import type { OrgletPlace } from '../../shared/unfriend';
import { t } from '../i18n';
import {
  defaultKickedKeys,
  keptPlaces,
  placeKey,
  toggleKicked,
  unfriendOutcomeLine,
  type KeptPlace,
} from '../unfriendChoice';
import { Checkbox } from './Checkbox';
import { Button, Drawer } from './ui';

function PlaceName({ place }: { place: OrgletPlace }) {
  const Icon = place.kind === 'space' ? LayoutGrid : Hash;
  const name = place.kind === 'space' ? place.name : channelLabel(place.name);
  return <span className="unfriend-place-name"><Icon size={16} aria-hidden="true" /><span>{name}</span></span>;
}

/**
 * Unfriending an orglet that is still in spaces or channels: the person picks the places it must leave (all of them
 * to begin with). A place that would be left with no orglet always keeps this one. It only collects the choice;
 * the caller makes the call, so the dialog stays props and callbacks.
 */
export function UnfriendDialog({ open, orgletName, places, busy, onConfirm, onClose }: {
  open: boolean;
  orgletName: string;
  places: readonly OrgletPlace[];
  busy: boolean;
  onConfirm: (keep: KeptPlace[]) => void;
  onClose: () => void;
}) {
  const [kickedKeys, setKickedKeys] = useState(() => defaultKickedKeys(places));
  useEffect(() => {
    if (open) setKickedKeys(defaultKickedKeys(places));
    // Only when it opens: the places are fixed by the caller for one opening, and a re-render must not undo a choice.
  }, [open]);
  const line = unfriendOutcomeLine(places, kickedKeys);
  return <Drawer open={open} onClose={onClose} title={t('Hủy kết bạn với {0}', [orgletName])}>
    <div className="unfriend-dialog">
      <p className="muted">{t('{0} vẫn còn ở một số không gian và kênh. Chọn nơi {1} phải rời đi.', [orgletName, orgletName])}</p>
      <ul className="unfriend-places">
        {places.map(place => <li key={placeKey(place)} className="unfriend-place">
          <Checkbox
            checked={place.canKick && kickedKeys.has(placeKey(place))}
            disabled={!place.canKick || busy}
            description={place.canKick ? undefined : t('Nơi này sẽ không còn Tí nào, nên Tí được giữ lại.')}
            onChange={() => setKickedKeys(current => toggleKicked(current, place))}>
            <PlaceName place={place} />
          </Checkbox>
        </li>)}
      </ul>
      <p className={`outcome-line unfriend-status ${line.kind === 'removed' ? 'error' : 'muted'}`} role="status">
        {line.kind === 'removed'
          ? <><Trash2 size={16} aria-hidden="true" />{t('{0} sẽ bị xóa khỏi Orglet. Cuộc trò chuyện cũ vẫn giữ lịch sử.', [orgletName])}</>
          : <><Info size={16} aria-hidden="true" />{line.keptCount === 1
            ? t('{0} rời tin nhắn riêng nhưng vẫn trả lời ở một nơi được giữ.', [orgletName])
            : t('{0} rời tin nhắn riêng nhưng vẫn trả lời ở {1} nơi được giữ.', [orgletName, line.keptCount])}</>}
      </p>
      <div className="unfriend-actions">
        <Button variant="ghost" onClick={onClose}>{t('Thôi')}</Button>
        <Button variant="danger" disabled={busy} onClick={() => onConfirm(keptPlaces(places, kickedKeys))}><UserMinus size={16} />{t('Hủy kết bạn')}</Button>
      </div>
    </div>
  </Drawer>;
}
