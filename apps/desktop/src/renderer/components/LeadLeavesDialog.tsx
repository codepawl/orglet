import { useEffect, useState } from 'react';
import { UserRoundMinus } from 'lucide-react';
import type { Worker } from '../../shared/contracts';
import { t } from '../i18n';
import { Select } from './Select';
import { Button, Drawer } from './ui';

/**
 * Taking the lead out of a channel where the lead splits the work: the person picks who leads next (the first orglet
 * left to begin with), and one confirm removes the old lead and hands the job over. It only collects the choice; the
 * caller makes the call.
 */
export function LeadLeavesDialog({ open, leaving, staying, busy, onConfirm, onClose }: {
  open: boolean;
  leaving: Worker;
  /** The orglets that stay, in the member column's order. */
  staying: readonly Worker[];
  busy: boolean;
  onConfirm: (nextLeadId: string) => void;
  onClose: () => void;
}) {
  const [nextLeadId, setNextLeadId] = useState(staying[0]?.id ?? '');
  useEffect(() => {
    if (open) setNextLeadId(staying[0]?.id ?? '');
    // Only when it opens: a re-render while it is open must not undo the person's pick.
  }, [open]);
  return <Drawer open={open} onClose={onClose} title={t('Xóa {0} khỏi kênh này?', [leaving.name])}>
    <div className="lead-leaves-dialog">
      <p className="muted">{t('{0} đang là trưởng của kênh. Chọn Tí dẫn dắt tiếp theo.', [leaving.name])}</p>
      <Select ariaLabel={t('Trưởng mới')} value={nextLeadId} disabled={busy} onChange={setNextLeadId} options={staying.map(worker => ({ value: worker.id, label: worker.name }))} />
      <div className="lead-leaves-actions">
        <Button variant="ghost" onClick={onClose}>{t('Thôi')}</Button>
        <Button variant="danger" disabled={busy || !nextLeadId} onClick={() => onConfirm(nextLeadId)}><UserRoundMinus size={16} />{t('Xóa khỏi kênh')}</Button>
      </div>
    </div>
  </Drawer>;
}
