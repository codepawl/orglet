import { useEffect, useState, type CSSProperties, type PointerEvent } from 'react';
import { Skeleton, SkeletonGroup } from '@codepawl/orglet-ui';
import { Bell, BookOpen, CalendarClock, Plus, Settings } from './icons';
import { t } from '../i18n';
import { Orglet3D } from './Orglet3D';
import type { Moment } from './orgletStage';
import { Button } from './ui';
import { Composer } from './Composer';
import { SidebarSection } from './SidebarSection';

/*
 * What the window shows while SQLite opens, usually under a second and a few seconds on a cold start. The shell is
 * drawn on the first frame (COD-218): the sidebar at the width the person left it, its two sections with the shape
 * of rows, the footer, the main column with the prompt bar in place. Nothing waits on the workspace but the words
 * that need it. The 3D orglet does the waiting where the chat's face will be (COD-156): monochrome like the brand
 * mark, it hops in, turns to follow the pointer, blinks, and smiles when the screen is tapped. The wait is told in
 * stages rather than one frozen line: after a few seconds the copy admits it is taking longer and the face glances
 * aside; after a long spell it says what to do and the face dozes off. The workspace arriving replaces the shell
 * in place, mid-hop if need be; the face never demands to finish.
 */

// The size of the 64-unit drawing in pixels; its canvas is twice that, out of layout.
const FACE_SIZE = 80;
// The face's personality is fixed, so the app opens with the same orglet every time.
const FACE_SEED = 29;
// After this many seconds the copy admits the wait is longer than usual, and after that many it says what to do.
const SLOW_AFTER_SECONDS = 3;
const STUCK_AFTER_SECONDS = 15;
// How many rows each sidebar section shows the shape of before the workspace says how many there are.
const TEAM_ROW_SHAPES = 1;
const WORKER_ROW_SHAPES = 3;
const DEFAULT_SIDEBAR_WIDTH = 228;

type Wait = 'opening' | 'slow' | 'stuck';
type Cue = { kind: Moment; count: number };

const nextCue = (kind: Moment) => (previous: Cue | undefined): Cue => ({ kind, count: (previous?.count ?? 0) + 1 });

/** The shape of a sidebar row: a face and a name, at the row's own height. */
function RowShapes({ count, label }: { count: number; label: string }) {
  return <SkeletonGroup label={label}>
    {Array.from({ length: count }, (_, index) => <div key={index} className="row-shape">
      <Skeleton shape="circle" className="row-shape-face" delay={index * 0.06} />
      <Skeleton width={`${62 - index * 9}%`} delay={index * 0.06} />
    </div>)}
  </SkeletonGroup>;
}

export function Startup({ error, onRetry, sidebar = true, sidebarWidth = DEFAULT_SIDEBAR_WIDTH }: { error?: string; onRetry?: () => void; sidebar?: boolean; sidebarWidth?: number }) {
  const [wait, setWait] = useState<Wait>('opening');
  const [cheer, setCheer] = useState(0);
  const [cue, setCue] = useState<Cue>();
  useEffect(() => {
    if (error) return;
    const slow = setTimeout(() => { setWait('slow'); setCue(nextCue('glance')); }, SLOW_AFTER_SECONDS * 1000);
    const stuck = setTimeout(() => { setWait('stuck'); setCue(nextCue('doze')); }, STUCK_AFTER_SECONDS * 1000);
    return () => { clearTimeout(slow); clearTimeout(stuck); };
  }, [error]);
  // An error lands as a wince.
  useEffect(() => { if (error) setCue(nextCue('squint')); }, [error]);
  // A tap anywhere on the screen makes the face smile; buttons keep their own click.
  const tap = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button')) return;
    setCheer(count => count + 1);
  };
  const waiting = wait === 'stuck' ? t('Mở lâu hơn bình thường. Nếu vẫn không xong, đóng rồi mở lại Orglet.') : wait === 'slow' ? t('Vẫn đang mở, chờ chút…') : t('Đang mở workspace…');
  const footer = [
    { icon: <Bell size={18} />, label: t('Thông báo') },
    { icon: <CalendarClock size={18} />, label: t('Lịch chạy') },
    { icon: <BookOpen size={18} />, label: t('Thư viện') },
    { icon: <Settings size={18} />, label: t('Cài đặt') },
  ];
  return <div className={`app startup${sidebar ? '' : ' sidebar-hidden'}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties} onPointerDown={tap}>
    <aside className={`sidebar${sidebar ? '' : ' collapsed'}`} aria-label={t('Điều hướng')} inert={!sidebar || undefined}>
      <div className="brand"><span className="orglet-mark">o</span><strong>Orglet</strong></div>
      <div className="sidebar-scroll">
        <SidebarSection id="teams" title={t('Hội')}><RowShapes count={TEAM_ROW_SHAPES} label={t('Đang mở danh sách hội…')} /></SidebarSection>
        <SidebarSection id="workers" title={t('Tí')}><RowShapes count={WORKER_ROW_SHAPES} label={t('Đang mở danh sách Tí…')} /></SidebarSection>
      </div>
      <div className="sidebar-footer">{footer.map(item => <Button key={item.label} disabled>{item.icon}{item.label}</Button>)}</div>
    </aside>
    <main className="main-pane" id="main-content" tabIndex={-1}>
      <header className="topbar"><div /></header>
      <div className="team-chat team-chat-fresh">
        <div className="fresh-chat team-chat-empty">
          <div className="fresh-faces">
            <div className="startup-face">
              <Orglet3D id="classic" seed={FACE_SEED} size={FACE_SIZE} color="mono" motion={{ lead: true, greet: true, cheer, moment: cue }} />
            </div>
          </div>
          <div className="startup-copy">
            <h1 className="welcome">Orglet</h1>
            <p role={error ? 'alert' : 'status'}>{error || waiting}</p>
            {error && onRetry && <Button variant="outline" onClick={onRetry}>{t('Thử lại')}</Button>}
          </div>
          <div className="thread-composer">
            <Composer value="" onChange={() => undefined} onSubmit={() => undefined} label={t('Tin nhắn')} placeholder={t('Nhắn với {0}…', [t('Tí')])} sendLabel={t('Gửi tin nhắn')} disabled
              leading={<Button type="button" size="icon" className="composer-add" aria-label={t('Thêm nguồn')} disabled><Plus size={20} /></Button>} />
          </div>
        </div>
      </div>
      <footer className="main-footer">{t('Orglet không đảm bảo câu trả lời luôn chính xác. Hãy kiểm chứng với nguồn gốc trước khi dùng.')}</footer>
    </main>
  </div>;
}
