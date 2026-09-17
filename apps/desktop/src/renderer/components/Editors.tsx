import { useState } from 'react';
import type { Skill } from '../../shared/contracts';
import { Button, FieldLabel } from './ui';
import { Sparkles, FileText } from 'lucide-react';
import { SkillReview } from './SkillReview';
import { t } from '../i18n';
import { orglet } from '../api';

export function SkillEditor({ skill, done }: { skill?: Skill; done: () => void }) {
  return skill?.package ? <SkillReview skill={skill} done={done} /> : <PlainSkillEditor skill={skill} done={done} />;
}
function PlainSkillEditor({ skill, done }: { skill?: Skill; done: () => void }) {
  const [name, setName] = useState(skill?.name ?? ''); const [content, setContent] = useState(skill?.content ?? '');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <form className="form" onSubmit={async e => {
    e.preventDefault(); setBusy(true);
    try { await orglet.call('saveSkill', { ...(skill ? { id: skill.id } : {}), name, content }); done(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }}>
    <label><FieldLabel icon={Sparkles} required>{t('Tên skill')}</FieldLabel><input value={name} onChange={e => setName(e.target.value)} required maxLength={80} /></label>
    <label><FieldLabel icon={FileText} required>{t('Nội dung')}</FieldLabel><textarea rows={16} value={content} onChange={e => setContent(e.target.value)} required maxLength={16000} /></label>
    <p className="muted">{t('Skill chỉ chứa hướng dẫn. Nội dung không cấp quyền chạy script hay mở thêm tệp.')}</p>
    {error && <p role="alert" className="error">{error}</p>}
    <Button variant="primary" disabled={busy}>{busy ? t('Đang lưu…') : t('Lưu skill')}</Button>
    {skill && <Button type="button" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await orglet.exportSkill(skill.id); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    }}>{t('Xuất skill đã lưu')}</Button>}
  </form>;
}
