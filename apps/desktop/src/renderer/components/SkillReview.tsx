import { useEffect, useState } from 'react';
import type { Skill } from '../../shared/contracts';
import { skillSummary } from '../../shared/skill-summary';
import { Button } from './ui';
import { FileText, FolderInput, Plus, Sparkles } from 'lucide-react';
import { Select } from './Select';
import { toast } from './toast';
import { t } from '../i18n';
import { orglet } from '../api';
import { Checkbox } from './Checkbox';
import { Skeleton, SkeletonGroup, SkeletonText, Textarea } from '@codepawl/orglet-ui';
import { skillReviews } from '../caches';
import { dwellHandlers, useCached } from '../prefetch';

/** Import and create actions for the Skills tab; they sit on the library's tab row. */
export function SkillLibraryActions({ onOpen }: { onOpen: (skill?: Skill) => void }) {
  const [busy, setBusy] = useState(false);
  return <>
    <Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const skill = await orglet.importSkill(); if (skill) onOpen(skill); }
      catch (err) { toast((err as Error).message, 'error', t('Nhập skill từ thư mục')); } finally { setBusy(false); }
    }}><FolderInput size={16} />{t('Nhập từ thư mục')}</Button>
    <Button variant="outline" onClick={() => onOpen()}><Plus size={16} />{t('Tạo skill')}</Button>
  </>;
}

export function SkillLibrary({ skills, onOpen }: { skills: Skill[]; onOpen: (skill?: Skill) => void }) {
  return <div className="form">
    {skills.map(skill => {
      const summary = skillSummary(skill.content);
      // An imported package is read from disk when its review opens; resting on the row reads it ahead of the click.
      return <Button key={skill.id} variant="outline" className="library-item" onClick={() => onOpen(skill)} {...dwellHandlers(skill.package ? resting => skillReviews.dwell(skillReviewKey(skill), resting) : undefined)}>
        <Sparkles size={18} aria-hidden="true" className="library-icon" />
        <span className="library-text">
          <span className="library-title">{skill.name}</span>
          {summary && <span className="library-summary">{summary}</span>}
          {skill.package && <small className="muted">{t('Gói {0} · {1}', [skill.package.hash.slice(0, 8), skill.package.reviewedHash === skill.package.hash ? t('Đã review') : t('Cần review')])}</small>}
        </span>
        <span className="badge">v{skill.revision}</span>
      </Button>;
    })}
  </div>;
}

/** The key a package's review is kept under: the hash pins it to one immutable package. */
export const skillReviewKey = (skill: Skill) => `${skill.id}:${skill.package?.hash ?? ''}`;

export function SkillReview({ skill, done }: { skill: Skill; done: () => void }) {
  // Kept for the session (COD-218): the Library row resting under the pointer reads the package ahead of the click.
  const review = useCached(skillReviews, skillReviewKey(skill));
  const [path, setPath] = useState('SKILL.md');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (review) return;
    let active = true;
    skillReviews.read(skillReviewKey(skill)).catch(err => { if (active) setError((err as Error).message); });
    return () => { active = false; };
  }, [skill, review]);
  const file = review?.files.find(item => item.path === path);
  return <div className="form">
    <h3>{skill.name}</h3>
    {!review && !error && <SkeletonGroup label={t('Đang đọc gói skill…')}><SkeletonText lines={4} /><Skeleton shape="block" className="skill-review-shape" /></SkeletonGroup>}
    {review && <>
      <p>{review.metadata.description}</p>
      {review.metadata.compatibility && <p>{t('Yêu cầu môi trường: {0}', [review.metadata.compatibility])}</p>}
      {review.metadata.license && <p>{t('Giấy phép: {0}', [review.metadata.license])}</p>}
      {review.metadata['allowed-tools'] && <p>{t('Tool được khai báo: {0}', [review.metadata['allowed-tools']])}</p>}
      <p className="muted">{t('Gói được giữ nguyên để xem và xuất lại. Tí chỉ đọc text trong references/ và assets/ khi cần. Script không được thực thi. Nội dung skill không cấp quyền nguồn hoặc tăng ngân sách.')}</p>
      {review.blockers.length > 0 && <div role="alert"><p>{t('Chưa thể sử dụng gói này:')}</p><ul>{review.blockers.map((reason, index) => <li key={index}>{reason}</li>)}</ul><p>{t('Sửa khai báo và nội dung ở thư mục gốc rồi nhập lại.')}</p></div>}
      <Select label={t('Tệp trong gói')} value={path} onChange={setPath} menuMinWidth={280} options={review.files.map(item => ({ value: item.path, label: item.path, detail: `${item.bytes} bytes`, icon: <FileText size={16} /> }))} />
      {file && (file.text !== null ? <Textarea aria-label={t('Nội dung {0}', [file.path])} readOnly rows={14} value={file.text} /> : <p>{t('Tệp nhị phân: giữ nguyên khi xuất, không gửi cho model.')}</p>)}
      <details><summary>{t('Metadata và hash')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(review.metadata.metadata ?? {}, null, 2)}{'\n'}SHA-256: {review.hash}</pre></details>
      {skill.package?.reviewedHash === review.hash ? <p role="status">{t('Đã review trên máy này.')}</p> : <>
        <Checkbox required checked={accepted} onChange={e => setAccepted(e.target.checked)} disabled={review.blockers.length > 0}>{t('Tôi đã xem nội dung và đồng ý dùng gói này làm hướng dẫn cho Tí.')}</Checkbox>
        <Button variant="primary" disabled={busy || !accepted || review.blockers.length > 0} onClick={async () => {
          setBusy(true); setError('');
          try { await orglet.call('reviewSkill', { id: skill.id, hash: review.hash }); done(); }
          catch (err) { setError((err as Error).message); } finally { setBusy(false); }
        }}>{t('Xác nhận review')}</Button>
      </>}
      <Button variant="outline" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { if (await orglet.exportSkill(skill.id)) toast(t('Đã xuất gói skill vào thư mục mới'), 'success', skill.name); }
        catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>{t('Xuất gói skill')}</Button>
    </>}
    {!review && !error && <p role="status">{t('Đang đọc gói skill…')}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}
