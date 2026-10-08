import { Plus, SlidersHorizontal } from 'lucide-react';
import type { Space } from '../../shared/spaces';
import { t } from '../i18n';
import { Button } from './ui';
import { PanelPage } from './PanelPage';
import { SpaceMark } from './SpaceMark';

/**
 * A space's own page in the main panel, shown right after the space is made: its name, what is in it, and the way to
 * its first channel. Without it the panel kept the chat that was open before, which belonged to another place than the
 * sidebar now listed.
 */
export function SpaceHomePage({ space, channelCount, onCreateChannel, onOpenSetup }: {
  space: Space;
  channelCount: number;
  onCreateChannel: () => void;
  onOpenSetup: () => void;
}) {
  const orgletCount = space.orgletIds.length;
  return <PanelPage className="space-home-page">
    <section className="space-home" aria-labelledby="space-home-title">
      <SpaceMark seed={space.id} color={space.color} />
      <h2 id="space-home-title">{space.name}</h2>
      <p className="muted">{orgletCount === 1 ? t('1 Tí trong không gian này.') : t('{0} Tí trong không gian này.', [orgletCount])}</p>
      <p className="muted">{channelCount === 0
        ? t('Chưa có kênh nào. Tạo kênh đầu tiên để các Tí bắt đầu làm việc cùng nhau.')
        : t('Chọn một kênh ở thanh bên, hoặc tạo kênh mới.')}</p>
      <div className="space-home-actions">
        <Button variant="primary" onClick={onCreateChannel}><Plus size={16} />{t('Tạo kênh')}</Button>
        <Button variant="outline" onClick={onOpenSetup}><SlidersHorizontal size={16} />{t('Thiết lập không gian')}</Button>
      </div>
    </section>
  </PanelPage>;
}
